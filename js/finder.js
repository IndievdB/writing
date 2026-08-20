// Word finder: search the lexicon by meaning (WordNet synonyms + reverse
// dictionary over glosses) and by sound (alliteration, assonance, consonance,
// rhyme, stress pattern, syllables, texture, origin, concreteness, rarity).
import { analyzeWord } from './phonology.js';
import { VOWELS } from './lexicon.js';
import { classifyOrigin } from './etymology.js';
import { FUNCTION_WORDS, IRREGULAR_PAST } from './wordlists.js';

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
    this.curatedPos = new Map(); // word -> Set of POS letters (from curated lines)
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
      if (pos) addPos(word, pos);
      for (const s of synStr.split(' ')) {
        if (!s || s === word) continue;
        link(word, s, 1.3);
        link(s, word, 1.1);
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

  // WordNet definitions for a word (or its lemma), up to `limit` senses.
  // Returns [{pos, gloss}] — pos is N/V/J/R or ''.
  definitionsFor(word, limit = 4) {
    const w = word.toLowerCase().replace(/[^a-z'\-]/g, '');
    if (!w) return [];
    const candidates = [...new Set(stem(w))];
    const d = this.detectInflection(w);
    if (d) candidates.push(d.lemma);
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
    const known = (x) => x.length >= 2 && (this.curated.has(x) || this.byWord.has(x) || this.lex.freq.has(x));
    const undouble = (x) => (/(.)\1$/.test(x) ? x.slice(0, -1) : null);
    const pick = (cands) => cands.filter(Boolean).find(known);
    const jish = (l) => this.posCap(l).includes('J');
    const vish = (l) => this.posCap(l).includes('V');
    let l;
    if (w.endsWith('ier') && (l = pick([w.slice(0, -3) + 'y'])) && jish(l)) return { lemma: l, kind: 'comparative' };
    if (w.endsWith('iest') && (l = pick([w.slice(0, -4) + 'y'])) && jish(l)) return { lemma: l, kind: 'superlative' };
    if (w.endsWith('ing') && w.length > 5 && (l = pick([undouble(w.slice(0, -3)), w.slice(0, -3), w.slice(0, -3) + 'e'])) && vish(l)) return { lemma: l, kind: 'gerund' };
    if (w.endsWith('ied') && (l = pick([w.slice(0, -3) + 'y'])) && vish(l)) return { lemma: l, kind: 'past' };
    if (w.endsWith('ed') && w.length > 4 && (l = pick([undouble(w.slice(0, -2)), w.slice(0, -2), w.slice(0, -1)])) && vish(l)) return { lemma: l, kind: 'past' };
    if (w.endsWith('est') && w.length > 4 && (l = pick([undouble(w.slice(0, -3)), w.slice(0, -3), w.slice(0, -2)])) && jish(l)) return { lemma: l, kind: 'superlative' };
    if (w.endsWith('er') && w.length > 3 && (l = pick([undouble(w.slice(0, -2)), w.slice(0, -2), w.slice(0, -1)])) && jish(l)) return { lemma: l, kind: 'comparative' };
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
        if (yStem) return [yStem + 'ied'];
        return [c.endsWith('e') ? c + 'd' : dbl + 'ed'];
      }
      case 'adverb': {
        if (!pos.includes('J')) return null;
        const adv = ly();
        // Only forms that actually exist: no fabricated "fastly". Flat
        // adverbs (fast, hard) come back as themselves.
        if (this.lex.phones.has(adv)) return [adv];
        return pos.includes('R') ? [c] : null;
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
        // When a seed has curated synonyms, use ONLY the curated graph —
        // WordNet synsets and gloss matches are fallback for uncovered words,
        // not extra noise for covered ones ("fast" gloss-matching destroyer,
        // "a small fast warship").
        const curatedOnly = stems.some((s) => this.curated.has(s));
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
        tests.push((p) => {
          const st = (p.dictStresses ?? p.stresses).map((s) => (s >= 1 ? '1' : '0'));
          if (st.length !== pat.length) return false;
          return st.every((s, i) => pat[i] === 'x' || pat[i] === '?' || pat[i] === s);
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

  // ---- main entry ----------------------------------------------------------

  search({ seeds = [], constraints = {}, limit = 120 }) {
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
        // rare. Inflected surfaces score by their lemma's frequency.
        const rank = info.freqRank ?? this.lex.freqRank(word) ?? 200000;
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
      if (!this.pool) {
        this.pool = [...this.lex.freq.keys()].filter(
          (w) => !FUNCTION_WORDS.has(w) && this.lex.phones.has(w),
        );
      }
      const cap = limit * 6;
      for (const w of this.pool) {
        consider(w, { score: 0, reasons: [] });
        if (results.length >= cap) break;
      }
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
