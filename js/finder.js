// Word finder: search the lexicon by meaning (WordNet synonyms + reverse
// dictionary over glosses) and by sound (alliteration, assonance, consonance,
// rhyme, stress pattern, syllables, texture, origin, concreteness, rarity).
import { analyzeWord } from './phonology.js';
import { VOWELS } from './lexicon.js';
import { classifyOrigin } from './etymology.js';
import { FUNCTION_WORDS, IRREGULAR_PAST, UNSTRESSED_MONOSYLLABLES, DUAL_STRESS_MONOSYLLABLES } from './wordlists.js';

// Stopwords for the definition-text index (function words + defining
// vocabulary that appears in half of all glosses).
const DEF_STOP = new Set(`
the and for with from that which who whom something someone person thing
things way state act acts quality manner made make makes making one ones
being having used uses especially usually often very into onto about
`.trim().split(/\s+/));

// A gloss token counts as the phrase-search genus only when it is not the
// object of a preposition ("shelter for a dog" defines a shelter, not a dog).
const PHRASE_PREP = new Set(['of', 'for', 'with', 'without', 'by', 'from', 'to',
  'at', 'in', 'on', 'into', 'onto', 'upon', 'over', 'under', 'near', 'around',
  'about', 'against', 'toward', 'towards', 'like', 'than', 'amid', 'among']);
const PHRASE_DET = new Set(['a', 'an', 'the', 'its', 'his', 'her', 'their',
  'your', 'our', 'one', 'two', 'many', 'some', 'each', 'every', 'another']);

// Heads that denote a person: "fast man" should match words defined as
// "a person who ..." even though the gloss never says "man".
const PHRASE_PERSON_HEADS = new Set(['man', 'woman', 'person', 'people',
  'human', 'guy', 'gal', 'fellow', 'dude', 'chap', 'bloke', 'lady',
  'gentleman', 'boy', 'girl', 'kid', 'child', 'adult', 'individual']);

const GLOSS_STOP = new Set(`
a an the of to in for on with or and by from as at that which who whom whose
be is are was been being have has had do does did not no it its this these
those there here such more most other another some any each often usually
someone something used use especially degree quality state act manner
`.trim().split(/\s+/));

// Derivational suffixes: seed + one of these = same lemma family, useless as
// a "synonym" ("walk" -> walking, walker, walkway).
const DERIV_SUFFIXES = ['s', 'es', 'ed', 'd', 'ing', 'er', 'ers', 'or', 'ly',
  'ness', 'ment', 'tion', 'ion', 'al', 'ful', 'less', 'able', 'ible', 'y',
  'ish', 'like',
  // phrasal compounds: walkway, walkout, runup, breakdown…
  'way', 'ways', 'out', 'over', 'about', 'up', 'down', 'off', 'in', 'on',
  'away', 'back', 'through'];

function sameFamily(seed, cand) {
  if (seed === cand) return true;
  const [a, b] = seed.length <= cand.length ? [seed, cand] : [cand, seed];
  // Bases: exact, e-dropped (make→making), consonant-doubled (run→running).
  for (const base of [a, a.slice(0, -1), a + a[a.length - 1]]) {
    if (base && b.startsWith(base)) {
      const rest = b.slice(base.length);
      if (DERIV_SUFFIXES.includes(rest) || rest.length <= 1) return true;
    }
  }
  return false;
}

const stem = (w) => {
  const out = [w];
  if (w.endsWith('ies') && w.length > 4) out.push(w.slice(0, -3) + 'y');
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) out.push(w.slice(0, -1));
  if (w.endsWith('ing') && w.length > 5) out.push(w.slice(0, -3), w.slice(0, -3) + 'e');
  if (w.endsWith('ed') && w.length > 4) out.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ly') && w.length > 4) out.push(w.slice(0, -2));
  return out;
};

export class Finder {
  constructor(lexicon) {
    this.lex = lexicon;
    this.synsets = [];        // {pos, members: [w], gloss}
    this.byWord = new Map();  // word -> [synset idx]
    this.byGloss = new Map(); // gloss token -> [synset idx]
    this.phonCache = new Map();
    this.infoCache = new Map();
    this.pool = null;         // frequency-ordered candidate words for seedless search
    this.curated = new Map(); // word -> Map(candidate -> weight), Claude-generated
    this.curatedFwd = new Map(); // word -> Map(pos -> Map(syn -> weight)), own lines only
    this.curatedPos = new Map(); // word -> Set of POS letters (from curated lines)
    this.headPos = new Map();    // word -> Set of POS letters (own headword lines only)
    this.defs = new Map();    // word -> [{pos, gloss}], curated definitions
    this.defIndex = new Map(); // definition token -> Set of headwords
    this.personIndex = new Set(); // headwords defined as "a person who ..."
    this.defTokenCache = new Map();
  }

  // Curated definitions file: word \t POS \t definition (1-3 lines per word).
  // Also builds an inverted index over definition text — the engine behind
  // two-word searches ("young man" -> words defined as young + man).
  loadDefinitions(raw) {
    for (const line of raw.split('\n')) {
      if (!line) continue;
      const [word, pos, gloss] = line.split('\t');
      if (!word || !gloss) continue;
      if (!this.defs.has(word)) this.defs.set(word, []);
      const list = this.defs.get(word);
      if (list.length < 3) list.push({ pos: pos || '', gloss });
      // "person" and "someone" are index stopwords, so person-denoting words
      // get their own index — how "fast man" reaches "a person who runs fast".
      if ((!pos || pos === 'N') && /\b(person|someone|somebody|people|one)\s+who\b|\ba person\b/.test(gloss)) {
        this.personIndex.add(word);
      }
      for (const t of gloss.toLowerCase().split(/[^a-z]+/)) {
        if (!t || t.length < 3 || DEF_STOP.has(t)) continue;
        if (!this.defIndex.has(t)) this.defIndex.set(t, new Set());
        this.defIndex.get(t).add(word);
      }
    }
  }

  // Definition-text tokens of a word (cached), optionally restricted to
  // glosses of one part of speech — a candidate noun's verb sense must not
  // satisfy a noun query ("gulp N: a hurried swallow" vs "gulp V").
  // Glosses of a word, falling back to its lemma's glosses for inflected
  // forms the definitions file doesn't list ("strolled" -> "stroll").
  glossesOf(word) {
    const own = this.defs.get(word);
    if (own) return own;
    const d = this.detectInflection(word);
    return (d && this.defs.get(d.lemma)) || [];
  }

  defTokens(word, pos = '') {
    const key = pos ? `${word}\t${pos}` : word;
    let s = this.defTokenCache.get(key);
    if (!s) {
      s = new Set();
      for (const d of this.glossesOf(word)) {
        if (pos && d.pos && d.pos !== pos) continue;
        for (const t of d.gloss.toLowerCase().split(/[^a-z]+/)) if (t.length >= 3) s.add(t);
      }
      this.defTokenCache.set(key, s);
    }
    return s;
  }

  // Claude-generated synonym file: word \t POS \t syn syn syn.
  // Forward links are strongest; being listed as someone's synonym is nearly
  // as strong, so the closure is built symmetric.
  loadSynonyms(raw) {
    const link = (a, b, w) => {
      if (!this.curated.has(a)) this.curated.set(a, new Map());
      const m = this.curated.get(a);
      if ((m.get(b) ?? 0) < w) m.set(b, w);
    };
    const addPos = (w, p) => {
      if (!this.curatedPos.has(w)) this.curatedPos.set(w, new Set());
      this.curatedPos.get(w).add(p);
    };
    for (const line of raw.split('\n')) {
      if (!line) continue;
      const [word, pos, synStr] = line.split('\t');
      if (!word || !synStr) continue;
      if (pos) {
        addPos(word, pos);
        // Own-line POS is strong evidence; propagated POS (below) is noisy.
        if (!this.headPos.has(word)) this.headPos.set(word, new Set());
        this.headPos.get(word).add(pos);
        if (!this.curatedFwd.has(word)) this.curatedFwd.set(word, new Map());
        if (!this.curatedFwd.get(word).has(pos)) this.curatedFwd.get(word).set(pos, new Map());
      }
      const fwd = pos ? this.curatedFwd.get(word).get(pos) : null;
      for (const s of synStr.split(' ')) {
        if (!s || s === word) continue;
        link(word, s, 1.3);
        link(s, word, 1.1);
        if (fwd && !fwd.has(s)) fwd.set(s, 1.3);
        if (pos) addPos(s, pos); // synonyms on a J line are adjectives too
      }
    }
  }

  // POS capabilities of a word: curated lines are the strongest signal, the
  // Brill lexicon fills in the rest.
  posCap(word) {
    let s = '';
    const cur = this.curatedPos.get(word);
    if (cur) s += [...cur].join('');
    for (const d of (this.defs.get(word) ?? [])) if (d.pos && !s.includes(d.pos)) s += d.pos;
    return s + this.lex.posFor(word);
  }

  loadThesaurus(raw) {
    for (const line of raw.split('\n')) {
      if (!line) continue;
      const [pos, memberStr, gloss = ''] = line.split('\t');
      const members = memberStr ? memberStr.split(' ') : [];
      if (!members.length) continue;
      const idx = this.synsets.length;
      this.synsets.push({ pos, members, gloss });
      for (const m of members) {
        if (!this.byWord.has(m)) this.byWord.set(m, []);
        this.byWord.get(m).push(idx);
      }
      for (const t of new Set(gloss.split(' '))) {
        if (!t || t.length < 3 || GLOSS_STOP.has(t)) continue;
        if (!this.byGloss.has(t)) this.byGloss.set(t, []);
        this.byGloss.get(t).push(idx);
      }
    }
  }

  glossTokens(si) {
    const s = this.synsets[si];
    if (!s.glossSet) {
      s.glossSet = new Set(s.gloss ? s.gloss.split(' ').filter((t) => t.length >= 3 && !GLOSS_STOP.has(t)) : []);
    }
    return s.glossSet;
  }

  // Definitions for a word (or its lemma), up to `limit` senses: curated
  // definitions first, WordNet glosses as fallback.
  definitionsFor(word, limit = 4) {
    const w = word.toLowerCase().replace(/[^a-z'\-]/g, '');
    if (!w) return [];
    const candidates = [...new Set(stem(w))];
    const d = this.detectInflection(w);
    if (d) candidates.push(d.lemma);
    for (const c of candidates) {
      const cur = this.defs.get(c);
      if (cur?.length) {
        return cur.slice(0, limit).map((x) => ({ ...x, of: c === w ? null : c }));
      }
    }
    for (const c of candidates) {
      const out = [];
      const seen = new Set();
      for (const si of this.byWord.get(c) ?? []) {
        const syn = this.synsets[si];
        if (!syn.gloss || seen.has(syn.gloss)) continue;
        seen.add(syn.gloss);
        out.push({ pos: syn.pos, gloss: syn.gloss, of: c === w ? null : c });
        if (out.length >= limit) break;
      }
      if (out.length) return out;
    }
    return [];
  }

  // Anything the finder can say something about counts as a known word —
  // curated entries, definitions, WordNet, the pronouncing dictionary, or a
  // recognizable inflection of one of those.
  isKnownWord(w) {
    return this.defs.has(w) || this.curated.has(w) || this.byWord.has(w) ||
      (this.lex.phones.has(w) && this.lex.freq.has(w)) || !!this.detectInflection(w);
  }

  // "Did you mean" candidates for a non-word: dictionary words within edit
  // distance 1 (distance 2 as a fallback), most common first.
  spellSuggestions(word, max = 6) {
    const known = (w) => (this.lex.freq.has(w) && this.lex.phones.has(w)) ||
      this.defs.has(w) || this.curated.has(w);
    const AL = "abcdefghijklmnopqrstuvwxyz'-";
    const edits = (w) => {
      const out = new Set();
      for (let i = 0; i <= w.length; i++) {
        const a = w.slice(0, i), b = w.slice(i);
        if (b) out.add(a + b.slice(1));
        if (b.length > 1) out.add(a + b[1] + b[0] + b.slice(2));
        for (const c of AL) {
          if (b) out.add(a + c + b.slice(1));
          out.add(a + c + b);
        }
      }
      return out;
    };
    let cands = [...edits(word)].filter((w) => w !== word && w.length > 1 && known(w));
    if (!cands.length && word.length <= 10) {
      const found = new Set();
      for (const e of edits(word)) {
        for (const w of edits(e)) {
          if (w !== word && w.length > 1 && !found.has(w) && known(w)) found.add(w);
        }
      }
      cands = [...found];
    }
    const rank = (w) => this.lex.freq.get(w) ?? this.lex.freqRank(w) ?? 1e9;
    return [...new Set(cands)].sort((a, b) => rank(a) - rank(b)).slice(0, max);
  }

  phon(word) {
    let p = this.phonCache.get(word);
    if (!p) {
      const phones = this.lex.phonesFor(word);
      if (!phones) return null;
      p = analyzeWord(word, phones);
      this.phonCache.set(word, p);
    }
    return p;
  }

  info(word) {
    let x = this.infoCache.get(word);
    if (!x) {
      const phon = this.phon(word);
      if (!phon) return null;
      const freqRank = this.lex.freqRank(word);
      x = {
        word, phon, freqRank,
        conc: this.lex.concretenessFor(word),
        ety: classifyOrigin(word, { syllableCount: phon.syllableCount, freqRank }),
      };
      this.infoCache.set(word, x);
    }
    return x;
  }

  // ---- inflection-aware search ---------------------------------------------
  // "faster" is nobody's headword. Detect seed inflections (comparative,
  // superlative, plural/3rd-person, past, gerund, -ly adverb), search on the
  // lemma, keep only candidates that can hold the same part of speech, and
  // re-inflect each result ("faster" -> quicker, speedier, more rapid).

  detectInflection(w) {
    // A word with a substantive curated entry is its own headword — don't
    // reinterpret it as an inflection ("sober" is not "more sob"). Thin
    // stray entries (a couple of links) don't block inflection search.
    if ((this.curated.get(w)?.size ?? 0) >= 5) return null;
    const undouble = (x) => (/(.)\1$/.test(x) ? x.slice(0, -1) : null);
    // Tiered lemma pick: curated headwords beat WordNet words beat bare
    // frequency-list tokens (the subtitle list contains junk like "rac"
    // that would otherwise shadow "race").
    const pick = (cands) => {
      const cs = cands.filter((x) => x && x.length >= 2);
      return cs.find((x) => this.curated.has(x))
        ?? cs.find((x) => this.byWord.has(x))
        ?? cs.find((x) => this.lex.freq.has(x));
    };
    // Comparative detection needs STRONG adjective evidence. A lemma's own
    // curated headword lines are authoritative when they exist (jump: N,V —
    // so "jumper" is an agent noun despite Brill's noisy J tag); Brill is
    // only the fallback for words without curated lines.
    const jish = (l) => {
      const own = this.headPos.get(l);
      if (own) return own.has('J');
      return this.lex.posFor(l).includes('J');
    };
    const vish = (l) => this.posCap(l).includes('V');
    let l;
    if (w.endsWith('ier') && (l = pick([w.slice(0, -3) + 'y'])) && jish(l)) return { lemma: l, kind: 'comparative' };
    if (w.endsWith('iest') && (l = pick([w.slice(0, -4) + 'y'])) && jish(l)) return { lemma: l, kind: 'superlative' };
    if (w.endsWith('ing') && w.length > 5 && (l = pick([undouble(w.slice(0, -3)), w.slice(0, -3), w.slice(0, -3) + 'e'])) && vish(l)) return { lemma: l, kind: 'gerund' };
    if (w.endsWith('ied') && (l = pick([w.slice(0, -3) + 'y'])) && vish(l)) return { lemma: l, kind: 'past' };
    if (w.endsWith('ed') && w.length > 4 && (l = pick([undouble(w.slice(0, -2)), w.slice(0, -2), w.slice(0, -1)])) && vish(l)) return { lemma: l, kind: 'past' };
    if (w.endsWith('est') && w.length > 4 && (l = pick([undouble(w.slice(0, -3)), w.slice(0, -3), w.slice(0, -2)])) && jish(l)) return { lemma: l, kind: 'superlative' };
    if (w.endsWith('er') && w.length > 3 && (l = pick([undouble(w.slice(0, -2)), w.slice(0, -2), w.slice(0, -1)]))) {
      if (jish(l)) return { lemma: l, kind: 'comparative' };
      if (vish(l)) return { lemma: l, kind: 'agent' }; // tester = one who tests
    }
    if (w.endsWith('or') && w.length > 4 && (l = pick([w.slice(0, -2), w.slice(0, -2) + 'e'])) && vish(l)) return { lemma: l, kind: 'agent' };
    if (w.endsWith('ily') && (l = pick([w.slice(0, -3) + 'y'])) && jish(l)) return { lemma: l, kind: 'adverb' };
    if (w.endsWith('ly') && w.length > 4 && (l = pick([w.slice(0, -2), w.slice(0, -2) + 'e'])) && jish(l)) return { lemma: l, kind: 'adverb' };
    if (w.endsWith('ies') && w.length > 4 && (l = pick([w.slice(0, -3) + 'y']))) return { lemma: l, kind: 'sform' };
    if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3 && (l = pick([w.slice(0, -1), w.slice(0, -2)]))) return { lemma: l, kind: 'sform' };
    return null;
  }

  // Surface forms of a candidate lemma under an inflection kind, or null when
  // the candidate can't hold that part of speech (gating out the "faster ->
  // accelerate" class of junk).
  inflectFor(c, kind) {
    if (c.includes(' ')) return null;
    const pos = this.posCap(c);
    const cvc = /[^aeiou][aeiou][^aeiouwxy]$/.test(c) && this.phon(c)?.syllableCount === 1;
    const dbl = cvc ? c + c[c.length - 1] : c;
    const yStem = /[^aeiou]y$/.test(c) ? c.slice(0, -1) : null;
    const ly = () => (yStem ? yStem + 'ily'
      : c.endsWith('ic') ? c + 'ally'
      : c.endsWith('le') ? c.slice(0, -1) + 'y'
      : c.endsWith('ll') ? c + 'y'
      : c + 'ly');
    switch (kind) {
      case 'sform': {
        if (!/[NV]/.test(pos)) return null;
        if (yStem) return [yStem + 'ies'];
        return [/(s|x|z|ch|sh)$/.test(c) ? c + 'es' : c + 's'];
      }
      case 'gerund': {
        if (!pos.includes('V')) return null;
        const stem = /[^eyoa]e$/.test(c) ? c.slice(0, -1) : dbl;
        return [stem + 'ing'];
      }
      case 'past': {
        if (!pos.includes('V')) return null;
        const irr = IRREGULAR_PAST.get(c);
        if (irr) return [irr];
        const form = yStem ? yStem + 'ied' : c.endsWith('e') ? c + 'd' : dbl + 'ed';
        // Only attested pasts — an unlisted irregular ("splitted") or a junk
        // stem ("revsed") must drop out, not surface fabricated.
        return this.lex.phones.has(form) ? [form] : null;
      }
      case 'adverb': {
        if (!pos.includes('J')) return null;
        const adv = ly();
        // Only forms that actually exist: no fabricated "fastly". Flat
        // adverbs (fast, hard) come back as themselves.
        if (this.lex.phones.has(adv)) return [adv];
        return pos.includes('R') ? [c] : null;
      }
      case 'agent': {
        // One-who-does noun: race -> sprinter, speeder. Only attested words —
        // both pronounceable and in the frequency list — no fabrications.
        if (!pos.includes('V')) return null;
        const forms = c.endsWith('e')
          ? [c + 'r', c.slice(0, -1) + 'or']
          : [c + 'er', dbl + 'er', c + 'or'];
        for (const form of [...new Set(forms)]) {
          if (this.lex.phones.has(form) && this.lex.freq.has(form)) return [form];
        }
        return null;
      }
      case 'comparative':
      case 'superlative': {
        if (!pos.includes('J')) return null;
        const [suf, more] = kind === 'comparative' ? ['er', 'more'] : ['est', 'most'];
        const n = this.phon(c)?.syllableCount ?? 3;
        // Participle adjectives (pleased, delighted) never take -er/-est.
        if (!/(ed|id)$/.test(c) && (n === 1 || (n === 2 && c.endsWith('y')))) {
          return [yStem ? yStem + 'i' + suf : c.endsWith('e') ? c + suf.slice(1) : dbl + suf];
        }
        const out = [`${more} ${c}`];
        const adv = ly();
        if (this.lex.phones.has(adv)) out.push(`${more} ${adv}`);
        return out;
      }
      default: return [c];
    }
  }

  // ---- meaning search ------------------------------------------------------

  seedCandidates(seeds) {
    const cand = new Map(); // word -> {score, matched:Set<seed>, reasons:Set}
    const bump = (word, seed, score, reason) => {
      if (seeds.includes(word)) return;
      if (seeds.some((s) => sameFamily(s, word))) return; // walk -> walking is noise
      let c = cand.get(word);
      if (!c) { c = { score: 0, matched: new Set(), reasons: new Set(), hits: new Map() }; cand.set(word, c); }
      // Diminishing returns per seed: co-occurring with a polysemous seed in
      // ten synsets shouldn't drown single-synset exact synonyms.
      const n = c.hits.get(seed) ?? 0;
      c.hits.set(seed, n + 1);
      c.score += score / (1 + n);
      c.matched.add(seed);
      if (c.reasons.size < 3) c.reasons.add(reason);
    };
    // Per-seed neighborhood for the gloss bridge: DIRECT synonyms only
    // (WordNet direct members + curated links). One-hop chains are scored as
    // candidates but never used as bridge equivalences — "walk→pass→draw"
    // must not make "draw" count as meaning "walk".
    for (const rawSeed of seeds) {
      const neighborhood = new Set();
      const stems = stem(rawSeed);
      // Only the first stem with any signal generates candidates; the other
      // stems ("slowly"→"slow") feed the bridge neighborhood only, so their
      // unrelated senses (slow = dull-witted) don't pollute the results.
      const primary = stems.find((s) => this.curated.has(s) || this.byWord.has(s) || this.byGloss.has(s)) ?? stems[0];
      for (const seed of stems) {
        const isPrimary = seed === primary;

        // Curated (Claude-generated) synonyms: the strongest signal, plus a
        // shallow second hop through the curated graph only.
        // When a seed has a reasonably rich curated entry, use ONLY the
        // curated graph — WordNet synsets and gloss matches are fallback for
        // uncovered or thin words, not extra noise for covered ones ("fast"
        // gloss-matching destroyer, "a small fast warship").
        const curatedOnly = stems.some((s) => (this.curated.get(s)?.size ?? 0) >= 5);
        const cur = this.curated.get(seed);
        if (cur) {
          for (const [m, w] of cur) {
            if (isPrimary) bump(m, rawSeed, w, `synonym of “${rawSeed}”`);
            neighborhood.add(m);
          }
          // One-hop expansion with triangle anchoring: a candidate reached
          // through a single intermediate is polysemy bait (sad -> blue ->
          // navy). Keep it only when it connects back to the seed's sense by
          // a second path: two distinct intermediates, its own entry linking
          // the seed, or its entry linking another of the seed's synonyms.
          if (isPrimary) {
            const hopVia = new Map(); // candidate -> Set(intermediates)
            for (const [m, w] of cur) {
              if (w < 1.2) continue;
              const second = this.curated.get(m);
              if (!second || second.size > 30) continue;
              for (const [n, w2] of second) {
                if (n === seed || cur.has(n) || w2 < 1.2) continue;
                if (!hopVia.has(n)) hopVia.set(n, new Set());
                hopVia.get(n).add(m);
              }
            }
            for (const [n, vias] of hopVia) {
              const nMap = this.curated.get(n);
              const anchored = vias.size >= 2 ||
                (nMap && (nMap.has(seed) ||
                  [...nMap.keys()].some((k) => cur.has(k) && !vias.has(k))));
              if (anchored) bump(n, rawSeed, 0.35, `near “${rawSeed}” (via ${[...vias][0]})`);
            }
          }
        }

        // WordNet + reverse dictionary: candidates only for seeds with no
        // curated entry (they still feed the bridge neighborhood below).
        const direct = this.byWord.get(seed) ?? [];
        const directMembers = new Set();
        for (const si of direct) {
          for (const m of this.synsets[si].members) {
            if (m === seed) continue;
            directMembers.add(m);
            if (isPrimary && !curatedOnly) bump(m, rawSeed, 0.8, `synonym of “${rawSeed}”`);
          }
        }
        if (!curatedOnly) {
          // One hop out: synonyms-of-synonyms, at reduced weight.
          for (const m of directMembers) {
            for (const si of this.byWord.get(m) ?? []) {
              const syn = this.synsets[si];
              if (syn.members.length > 12) continue;
              for (const n of syn.members) {
                if (n !== seed && !directMembers.has(n)) {
                  if (isPrimary) bump(n, rawSeed, 0.2, `near “${rawSeed}” (via ${m})`);
                }
              }
            }
          }
          // Reverse dictionary: seed appears in a definition.
          if (isPrimary) {
            for (const si of this.byGloss.get(seed) ?? []) {
              for (const m of this.synsets[si].members) {
                bump(m, rawSeed, 0.45, `defined with “${rawSeed}”`);
              }
            }
          }
        }
        for (const m of directMembers) neighborhood.add(m);
        neighborhood.add(seed);
      }
    }
    // Multiple seeds are ADDITIVE: each contributes its own synonyms to the
    // pool. A word related to several seeds naturally sums their scores.
    return cand;
  }

  // ---- constraints ---------------------------------------------------------

  // Build a predicate + soft-scorer from the constraint inputs.
  compileConstraints(c) {
    const tests = [];
    const soft = [];

    // "Sounds like": one or more target words. Each carries an optional
    // per-sound selection with a per-sound position (anywhere / at the start /
    // at the end), and an optional "grouped" flag meaning the selected sounds
    // must appear as one consecutive run in the result. This subsumes
    // alliteration (opening cluster grouped at start), assonance (a vowel,
    // anywhere), and consonance (a consonant, anywhere).
    // The start region runs through the first vowel; end from the last vowel.
    const region = (p, pos) => {
      const ph = p.phones ?? [];
      if (!ph.length || pos === 'any') return ph;
      if (pos === 'start') {
        const i = ph.findIndex((x) => VOWELS.has(x));
        return ph.slice(0, (i < 0 ? ph.length - 1 : i) + 1);
      }
      let i = -1;
      for (let k = ph.length - 1; k >= 0; k--) if (VOWELS.has(ph[k])) { i = k; break; }
      return ph.slice(i < 0 ? 0 : i);
    };
    const seqMatch = (ph, seq, mustStart, mustEnd) => {
      if (!ph?.length || seq.length > ph.length) return false;
      const last = ph.length - seq.length;
      for (let s = mustStart ? 0 : 0; s <= (mustStart ? 0 : last); s++) {
        if (mustEnd && s !== last) continue;
        let ok = true;
        for (let i = 0; i < seq.length; i++) if (ph[s + i] !== seq[i]) { ok = false; break; }
        if (ok) return true;
      }
      return false;
    };
    for (const spec of Array.isArray(c.sl) ? c.sl : []) {
      const target = this.phon((spec.word ?? '').trim().toLowerCase());
      if (!target?.phones?.length) continue;
      const sel = (spec.sel ?? []).filter((s) => s.ph);
      if (sel.length >= 2 && spec.grouped) {
        // Grouped: the chosen sounds, in order, as one consecutive run.
        const seq = sel.map((s) => s.ph);
        const mustStart = sel[0].pos === 'start';
        const mustEnd = sel[sel.length - 1].pos === 'end';
        tests.push((p, word) => word !== spec.word && seqMatch(p.phones, seq, mustStart, mustEnd));
      } else if (sel.length) {
        // Per-sound placement: each chosen sound in its own region.
        tests.push((p, word) => {
          if (word === spec.word) return false;
          return sel.every((s) => region(p, s.pos ?? 'any').includes(s.ph));
        });
      } else {
        // No specific sounds chosen: share enough distinct sounds overall.
        const distinct = [...new Set(target.phones)];
        const need = Math.min(2, distinct.length);
        tests.push((p, word) => {
          if (word === spec.word) return false;
          let n = 0;
          for (const s of distinct) if (p.phones?.includes(s)) n++;
          return n >= need;
        });
        soft.push((p) => {
          let n = 0;
          for (const s of new Set(target.phones)) if (p.phones?.includes(s)) n++;
          return (n / new Set(target.phones).size) * 0.8;
        });
      }
      // Sharing the target's stressed vowel or opening sound ranks higher —
      // that's what the ear notices first.
      soft.push((p) => (target.stressedVowel && p.stressedVowel === target.stressedVowel ? 0.5 : 0) +
        (p.phones?.[0] === target.phones[0] ? 0.4 : 0));
    }
    if (c.rhyme?.trim()) {
      const rp = this.phon(c.rhyme.trim().toLowerCase());
      const key = rp?.rhymeKey;
      const w = c.rhyme.trim().toLowerCase();
      if (key) tests.push((p, word) => word !== w && p.rhymeKey === key);
    }
    if (c.syll?.trim()) {
      const m = c.syll.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
      if (m) {
        const lo = Number(m[1]), hi = Number(m[2] ?? m[1]);
        tests.push((p) => p.syllableCount >= lo && p.syllableCount <= hi);
      }
    }
    if (c.stress?.trim()) {
      const pat = c.stress.trim().replace(/[´ˈ]/g, '1').replace(/[˘ˌ]/g, '0').replace(/[^10x?]/gi, '');
      if (pat) {
        // "x"/"?" = any stress for that syllable. Exact mode needs the same
        // syllable count; prefix mode ("starts with") just needs enough.
        const prefix = c.stressMode === 'prefix';
        tests.push((p, surface) => {
          const st = (p.dictStresses ?? p.stresses).map((s) => (s >= 1 ? '1' : '0'));
          // Prosody beats dictionary digits for one-syllable closed-class
          // words: clitics ("the", "him") are unstressed in running speech,
          // and dual-use words ("that", "some") match either pattern.
          if (st.length === 1 && surface) {
            if (UNSTRESSED_MONOSYLLABLES.has(surface)) st[0] = '0';
            else if (DUAL_STRESS_MONOSYLLABLES.has(surface)) st[0] = '*';
          }
          if (prefix ? st.length < pat.length : st.length !== pat.length) return false;
          for (let i = 0; i < pat.length; i++) {
            if (st[i] === '*') continue;
            if (pat[i] !== 'x' && pat[i] !== '?' && pat[i] !== st[i]) return false;
          }
          return true;
        });
      }
    }
    if (c.texture === 'soft') {
      tests.push((p) => {
        const cn = p.counts; if (!cn) return false;
        const softC = cn.liquids + cn.nasals + cn.glides;
        return cn.consonants === 0 || (softC / cn.consonants >= 0.5 && p.maxConsonantRun <= 2);
      });
      soft.push((p) => {
        const cn = p.counts; if (!cn?.consonants) return 0;
        return (cn.liquids + cn.nasals + cn.glides) / cn.consonants;
      });
    } else if (c.texture === 'hard') {
      tests.push((p) => {
        const cn = p.counts; if (!cn?.consonants) return false;
        return (cn.plosives + cn.sibilants) / cn.consonants >= 0.5;
      });
      soft.push((p) => {
        const cn = p.counts; if (!cn?.consonants) return 0;
        return (cn.plosives + cn.sibilants) / cn.consonants;
      });
    }
    return { tests, soft };
  }

  // ---- two-word phrase search ----------------------------------------------
  // "young man" -> lad, youth, boy. One word is the HEAD (what kind of thing
  // comes back), the other the MODIFIER (a filter over candidate
  // definitions). Nothing is precomputed per pair — composition happens here.

  phraseRoles(a, b) {
    // verb + manner adverb: "ran quickly" (head = verb, results are verbs)
    const bAdv = b.endsWith('ly') || (this.posCap(b).includes('R') && !this.posCap(b).includes('N'));
    if (bAdv && (this.posCap(a).includes('V') || this.detectInflection(a)?.kind)) {
      return { head: a, mod: b, wantPos: 'V' };
    }
    // default English compound: modifier first, noun head last ("young man")
    return { head: b, mod: a, wantPos: 'N' };
  }

  // All attested agent nouns of defined verbs: [["sprinter","sprint"], ...].
  // Built once, on first phrase search with a person head.
  agentNouns() {
    if (!this._agentNouns) {
      this._agentNouns = [];
      for (const [w, senses] of this.defs) {
        if (!senses.some((g) => !g.pos || g.pos === 'V')) continue;
        const forms = this.inflectFor(w, 'agent');
        if (forms) this._agentNouns.push([forms[0], w]);
      }
    }
    return this._agentNouns;
  }

  searchPhrase(a, b, constraints = {}, limit = 2000) {
    const { head, mod, wantPos } = this.phraseRoles(a, b);
    const d = this.detectInflection(head);
    let headLemma = d?.lemma ?? head;
    let kind = d?.kind ?? null;
    // "ran quickly": the adverb forces a verb reading, so an irregular past
    // is safely the verb's past even when it is its own curated headword.
    if (!kind && wantPos === 'V') {
      for (const [lemma, past] of IRREGULAR_PAST) {
        if (past === head && lemma !== head) { headLemma = lemma; kind = 'past'; break; }
      }
    }
    // Sense discipline: expand head and modifier only through curated lines
    // of the right POS when they exist ("wind" the noun must not pull in
    // twist/snake/coil from "wind" the verb).
    const posEntry = (w, p) => this.curatedFwd.get(w)?.get(p) ?? this.curated.get(w);

    // Modifier cluster: the word, its lemma, and their curated synonyms.
    const modPos = wantPos === 'V' ? 'R' : 'J';
    const modD = this.detectInflection(mod);
    const modLiteral = new Set([mod, modD?.lemma].filter(Boolean));
    const modCluster = new Set(modLiteral);
    for (const base of [...modLiteral]) {
      for (const syn of (posEntry(base, modPos)?.keys() ?? [])) modCluster.add(syn);
    }
    // Glosses describe actions with adverbs ("runs fast", "moves quickly")
    // and nouns ("a contest of speed"), so an adjective modifier also
    // matches through its attested -ly forms and -y noun stems.
    if (wantPos === 'N') {
      const advForms = (w) => (this.posCap(w).includes('J') && this.inflectFor(w, 'adverb')) || [];
      for (const w of [...modLiteral]) for (const f of advForms(w)) modLiteral.add(f);
      for (const w of [...modCluster]) {
        for (const f of advForms(w)) modCluster.add(f);
        if (w.endsWith('y') && this.lex.phones.has(w.slice(0, -1))) modCluster.add(w.slice(0, -1));
      }
    }
    // How strongly a candidate's definitions match the modifier (any gloss).
    const modHit = (w) => {
      const toks = this.defTokens(w, wantPos);
      for (const t of modLiteral) if (toks.has(t)) return 2;
      for (const t of modCluster) if (toks.has(t)) return 1;
      return 0;
    };
    // Sense coherence for the definition tiers: the genus and the modifier
    // must appear in the SAME gloss. "whiz: a skilled person / move fast" is
    // a skilled person or a fast movement — never a fast person.
    const gvCache = new Map();
    const glossViews = (w) => {
      let gv = gvCache.get(w);
      if (!gv) {
        gv = this.glossesOf(w)
          .filter((g) => !g.pos || g.pos === wantPos)
          .map((g) => {
            const toks = g.gloss.toLowerCase().split(/[^a-z]+/).filter(Boolean);
            return { toks, set: new Set(toks) };
          });
        gvCache.set(w, gv);
      }
      return gv;
    };
    const modIn = (set) => {
      for (const t of modLiteral) if (set.has(t)) return 2;
      for (const t of modCluster) if (set.has(t)) return 1;
      return 0;
    };
    const genusIn = (toks, tok) => {
      for (let i = 0; i < toks.length; i++) {
        if (toks[i] !== tok && toks[i] !== tok + 's') continue;
        const prev = toks[i - 1] ?? '';
        const prev2 = toks[i - 2] ?? '';
        if (PHRASE_PREP.has(prev) || (PHRASE_DET.has(prev) && PHRASE_PREP.has(prev2))) continue;
        return true;
      }
      return false;
    };
    const genusMod = (w, tok) => {
      let best = 0;
      for (const g of glossViews(w)) {
        if (genusIn(g.toks, tok)) best = Math.max(best, modIn(g.set));
      }
      return best;
    };

    // Candidate pool: words whose definition mentions the head, plus the
    // head's own synonyms (fallback tier so results never come up empty).
    const cands = new Map(); // word -> {score, reason}
    const put = (w, score, reason) => {
      if (w === head || w === headLemma || w === mod) return;
      const prev = cands.get(w);
      if (!prev || score > prev.score) cands.set(w, { score, reason });
    };
    const defHits = new Set([
      ...(this.defIndex.get(headLemma) ?? []),
      ...(this.defIndex.get(headLemma + 's') ?? []),
    ]);
    for (const w of defHits) {
      const m = genusMod(w, headLemma);
      if (m) put(w, 2 + m, m === 2 ? `defined as ${mod} + ${headLemma}` : `defined as ${headLemma}, ${mod}-like`);
    }
    // Person heads also match generic person-glosses: "wit: a person with a
    // quick sense of humor" answers "funny man" without saying "man".
    if (wantPos === 'N' && PHRASE_PERSON_HEADS.has(headLemma)) {
      for (const w of this.personIndex) {
        let m = 0;
        for (const t of ['person', 'someone', 'somebody', 'people']) {
          m = Math.max(m, genusMod(w, t));
          if (m === 2) break;
        }
        if (m) put(w, 1.8 + m, `a ${mod} person`);
      }
      // And agent nouns of matching verbs: "fast man" -> race ("move very
      // fast") -> racer. Attested -er/-or forms only; never a surface whose
      // own definition is a thing, not a person ("zipper" is a fastener);
      // and only LITERAL modifier matches — cluster synonyms drag in cross-
      // sense verbs ("fix: fasten firmly" is not a fast action).
      for (const [agent, verb] of this.agentNouns()) {
        if (this.defs.has(agent) && !this.personIndex.has(agent)) continue;
        let m = 0;
        for (const g of this.glossesOf(verb)) {
          if (g.pos && g.pos !== 'V') continue;
          const set = new Set(g.gloss.toLowerCase().split(/[^a-z]+/));
          m = Math.max(m, modIn(set));
          if (m === 2) break;
        }
        if (m === 2) put(agent, 1.7 + m, `one who ${verb}s ${mod}`);
      }
    }
    const headEntry = posEntry(headLemma, wantPos) ?? new Map();
    const headSyns = [...headEntry.keys()];
    // Words defined via a synonym of the head ("dirge: a mournful funeral
    // hymn" never says "song"). Only the head's own strong synonyms qualify
    // as bridges — weak reverse links import cross-sense junk.
    for (const [syn, wgt] of headEntry) {
      if (wgt < 1.2) continue;
      for (const w of (this.defIndex.get(syn) ?? [])) {
        const m = genusMod(w, syn);
        if (m) put(w, 1.6 + m, `defined as ${syn} (≈${headLemma}), ${mod}-like`);
      }
    }
    for (const w of headSyns) {
      const m = modHit(w);
      put(w, 1 + m * 1.5, m ? `synonym of “${headLemma}”, ${mod}-matching` : `synonym of “${headLemma}”`);
    }

    const { tests, soft } = this.compileConstraints(constraints);
    const results = [];
    for (const [w, c] of cands) {
      if (!this.posCap(w).includes(wantPos)) continue;
      if (constraints.type && !this.posCap(w).includes(constraints.type)) continue;
      const surfaces = kind ? this.inflectFor(w, kind) : [w];
      if (!surfaces) continue;
      for (const surface of surfaces) {
        if (surface === a || surface === b) continue;
        const info = this.info(surface);
        if (!info) continue;
        if (!tests.every((t) => t(info.phon, surface))) continue;
        // Origin/feel/rarity apply to phrase results the same as everywhere.
        const rank = info.freqRank ?? this.lex.freqRank(w) ?? 200000;
        if (constraints.rarity === 'rare' && rank < 8000) continue;
        if (constraints.rarity === 'common' && rank > 5000) continue;
        if (constraints.origin && info.ety.origin !== constraints.origin) continue;
        if (constraints.feel === 'concrete' && !(info.conc >= 350)) continue;
        if (constraints.feel === 'abstract' && !(info.conc != null && info.conc <= 260)) continue;
        let score = c.score;
        for (const s of soft) score += s(info.phon) * 0.8;
        score += (5.4 - Math.log10(rank)) * 0.1;
        results.push({ word: surface, score, info, reasons: [c.reason] });
      }
    }
    const bySurface = new Map();
    for (const r of results) {
      const prev = bySurface.get(r.word);
      if (!prev || r.score > prev.score) bySurface.set(r.word, r);
    }
    return [...bySurface.values()].sort((x, y) => y.score - x.score).slice(0, limit);
  }

  // ---- main entry ----------------------------------------------------------

  // Several comma-separated queries at once ("young man, lad" or "big, huge"):
  // each group runs as its own search and the result lists are interleaved
  // rank by rank, so every query is represented at the top.
  searchMulti(groups, constraints = {}, limit = 2000) {
    if (groups.length <= 1) {
      return this.search({ seeds: groups[0] ?? [], constraints, limit });
    }
    const lists = groups.map((seeds) => {
      const label = seeds.join(' ');
      const rs = this.search({ seeds, constraints, limit });
      for (const r of rs) r.reasons = [`for “${label}”`, ...r.reasons];
      return rs;
    });
    const merged = [];
    const seen = new Set();
    const longest = Math.max(...lists.map((l) => l.length));
    for (let i = 0; i < longest; i++) {
      for (const list of lists) {
        const r = list[i];
        if (r && !seen.has(r.word)) { seen.add(r.word); merged.push(r); }
      }
    }
    return merged;
  }

  search({ seeds = [], constraints = {}, limit = 2000 }) {
    // Two words = phrase search: head + modifier ("young man", "ran quickly").
    if (seeds.length === 2) {
      return this.searchPhrase(seeds[0], seeds[1], constraints, limit);
    }
    // Inflection awareness: an inflected seed ("faster", "running", "cats")
    // searches on its lemma, and every result is re-inflected to match.
    const originalSeeds = new Set(seeds);
    let kind = null;
    seeds = seeds.map((s) => {
      const d = this.detectInflection(s);
      // Re-inflect results only for single-seed queries: in "walk slowly"
      // the inflected word is a modifier, not the form the user wants back.
      if (d && seeds.length === 1) kind = d.kind;
      return d ? d.lemma : s;
    });

    const { tests, soft } = this.compileConstraints(constraints);
    const hasConstraints = tests.length > 0 || soft.length > 0;
    const seedless = !seeds.length;
    const results = [];

    const consider = (word, base) => {
      // Word-type filter: the candidate lemma must be able to serve as that
      // part of speech (curated POS lines + the Brill lexicon).
      if (constraints.type && !this.posCap(word).includes(constraints.type)) return;
      const surfaces = kind ? this.inflectFor(word, kind) : [word];
      if (!surfaces) return; // wrong part of speech for the seed's inflection
      for (const surface of surfaces) {
        if (originalSeeds.has(surface)) continue;
        const info = this.info(surface);
        if (!info) continue;
        const p = info.phon;
        if (!tests.every((t) => t(p, surface))) continue;
        let score = base.score;
        for (const s of soft) score += s(p) * 0.8;
        // Prefer common words a little (log-scaled), unless the user asked
        // rare. Inflected surfaces score by their lemma's frequency — except
        // in seedless sweeps, where the surface's own rank is the honest one
        // ("yous" must not borrow rank 1 from "you").
        const rank = (seedless ? this.lex.freq.get(surface) : null)
          ?? info.freqRank ?? this.lex.freqRank(word) ?? 200000;
        if (constraints.rarity === 'rare') {
          if (rank < 8000) continue;
          score += Math.log10(rank) * 0.1;
        } else {
          if (constraints.rarity === 'common' && rank > 5000) continue;
          score += (5.4 - Math.log10(rank)) * 0.12;
        }
        if (constraints.origin && info.ety.origin !== constraints.origin) continue;
        if (constraints.feel === 'concrete' && !(info.conc >= 350)) continue;
        if (constraints.feel === 'abstract' && !(info.conc != null && info.conc <= 260)) continue;
        results.push({ word: surface, score, info, reasons: [...base.reasons] });
      }
    };

    if (seeds.length) {
      const cand = this.seedCandidates(seeds);
      for (const [word, c] of cand) consider(word, c);
    } else {
      if (!hasConstraints && !constraints.origin && !constraints.feel && !constraints.rarity) return [];
      // Seedless: sweep the frequency-ordered pool under the constraints.
      // Function words stay in — a syllable/stress query should offer
      // "a", "the", "him" just like any content word.
      if (!this.pool) {
        this.pool = [...this.lex.freq.keys()].filter((w) => this.lex.phones.has(w));
      }
      const cap = limit * 3; // bound the sweep; matches beyond this are ever-rarer words
      for (const w of this.pool) {
        consider(w, { score: 0, reasons: [] });
        if (results.length >= cap) break;
      }
    }
    // Sparse inflected search: union in a direct search of the typed word —
    // "baker" the surface word has WordNet data its lemma path can't reach.
    if (kind && results.length < 5 && originalSeeds.size === 1) {
      const kept = kind;
      kind = null;
      seeds = [...originalSeeds];
      const cand = this.seedCandidates(seeds);
      for (const [word, c] of cand) consider(word, c);
      kind = kept;
    }

    // Two lemmas can inflect to the same surface — keep the best-scored one.
    const bySurface = new Map();
    for (const r of results) {
      const prev = bySurface.get(r.word);
      if (!prev || r.score > prev.score) bySurface.set(r.word, r);
    }
    return [...bySurface.values()]
      .sort((a, b) => b.score - a.score ||
        (a.info.freqRank ?? 1e9) - (b.info.freqRank ?? 1e9))
      .slice(0, limit);
  }
}
