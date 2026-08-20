// Word finder: search the lexicon by meaning (WordNet synonyms + reverse
// dictionary over glosses) and by sound (alliteration, assonance, consonance,
// rhyme, stress pattern, syllables, texture, origin, concreteness, rarity).
import { analyzeWord } from './phonology.js';
import { classifyOrigin } from './etymology.js';
import { FUNCTION_WORDS } from './wordlists.js';

// Spelling -> ARPAbet for onset/consonance inputs typed as letters.
const DIGRAPHS = { ch: 'CH', sh: 'SH', th: 'TH', ph: 'F', wh: 'W', ng: 'NG', qu: 'K W' };
const LETTER_PHONE = {
  b: 'B', c: 'K', d: 'D', f: 'F', g: 'G', h: 'HH', j: 'JH', k: 'K', l: 'L',
  m: 'M', n: 'N', p: 'P', q: 'K', r: 'R', s: 'S', t: 'T', v: 'V', w: 'W',
  x: 'K S', y: 'Y', z: 'Z',
};

const GLOSS_STOP = new Set(`
a an the of to in for on with or and by from as at that which who whom whose
be is are was been being have has had do does did not no it its this these
those there here such more most other another some any each often usually
someone something used use especially degree quality state act manner
`.trim().split(/\s+/));

function lettersToPhones(input) {
  const s = input.toLowerCase().replace(/[^a-z]/g, '');
  const phones = [];
  let i = 0;
  while (i < s.length) {
    const two = s.slice(i, i + 2);
    if (DIGRAPHS[two]) { phones.push(...DIGRAPHS[two].split(' ')); i += 2; continue; }
    const p = LETTER_PHONE[s[i]];
    if (p) phones.push(...p.split(' '));
    i++;
  }
  return phones;
}

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
    for (const line of raw.split('\n')) {
      if (!line) continue;
      const [word, , synStr] = line.split('\t');
      if (!word || !synStr) continue;
      for (const s of synStr.split(' ')) {
        if (!s || s === word) continue;
        link(word, s, 1.3);
        link(s, word, 1.1);
      }
    }
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
    const hood = new Map();
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
        const cur = this.curated.get(seed);
        if (cur) {
          for (const [m, w] of cur) {
            if (isPrimary) bump(m, rawSeed, w, `synonym of “${rawSeed}”`);
            neighborhood.add(m);
            if (!isPrimary) continue;
            const second = this.curated.get(m);
            if (second && second.size <= 30 && w >= 1.2) {
              for (const [n, w2] of second) {
                if (n === seed || cur.has(n)) continue;
                if (w2 >= 1.2) bump(n, rawSeed, 0.35, `near “${rawSeed}” (via ${m})`);
              }
            }
          }
        }

        const direct = this.byWord.get(seed) ?? [];
        const directMembers = new Set();
        for (const si of direct) {
          for (const m of this.synsets[si].members) {
            if (m === seed) continue;
            directMembers.add(m);
            if (isPrimary) bump(m, rawSeed, 0.8, `synonym of “${rawSeed}”`);
          }
        }
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
        for (const m of directMembers) neighborhood.add(m);
        neighborhood.add(seed);
      }
      hood.set(rawSeed, neighborhood);
    }

    // Cross-seed gloss bridge: a candidate matched by seed A also counts for
    // seed B when the candidate's own definition uses a word from B's synonym
    // neighborhood ("saunter: walk LEISURELY…" ← slowly→easy→leisurely).
    if (seeds.length > 1) {
      for (const [word, c] of cand) {
        for (const rawSeed of seeds) {
          if (c.matched.has(rawSeed)) continue;
          const nb = hood.get(rawSeed);
          if (!nb || nb.size === 0 || nb.size > 400) continue;
          let hit = null;
          for (const si of this.byWord.get(word) ?? []) {
            for (const t of this.glossTokens(si)) {
              if (nb.has(t)) { hit = t; break; }
            }
            if (hit) break;
          }
          if (hit) {
            c.score += 0.5;
            c.matched.add(rawSeed);
            if (c.reasons.size < 3) c.reasons.add(`defined with “${hit}” ≈ “${rawSeed}”`);
          }
        }
      }
    }

    // Definition-phrase match: one single definition of the candidate covers
    // EVERY seed ("saunter: walk leisurely…" for seeds walk+slowly). This is
    // the reverse-dictionary jackpot — reward it decisively.
    if (seeds.length > 1) {
      for (const [word, c] of cand) {
        for (const si of this.byWord.get(word) ?? []) {
          const toks = this.glossTokens(si);
          if (toks.size === 0) continue;
          const coversAll = seeds.every((rawSeed) => {
            if (toks.has(rawSeed)) return true;
            const nb = hood.get(rawSeed);
            if (!nb) return false;
            for (const t of toks) if (nb.has(t)) return true;
            return false;
          });
          if (coversAll) {
            c.score += 0.8;
            seeds.forEach((s) => c.matched.add(s));
            if (c.reasons.size < 3) c.reasons.add('definition matches the whole query');
            break;
          }
        }
      }
    }

    // Words matching several distinct seeds are what the user is circling.
    for (const c of cand.values()) {
      if (c.matched.size > 1) c.score *= 1 + 0.6 * (c.matched.size - 1);
    }
    return cand;
  }

  // ---- constraints ---------------------------------------------------------

  // Build a predicate + soft-scorer from the constraint inputs.
  compileConstraints(c) {
    const tests = [];
    const soft = [];

    if (c.allit?.trim()) {
      const target = this.onsetOf(c.allit.trim());
      if (target?.length) {
        tests.push((p) => {
          const on = p.onset ?? [];
          return target.every((ph, i) => on[i] === ph);
        });
      }
    }
    if (c.asson?.trim()) {
      const v = this.stressedVowelOf(c.asson.trim());
      if (v) tests.push((p) => p.stressedVowel === v);
    }
    if (c.conson?.trim()) {
      const phones = lettersToPhones(c.conson);
      if (phones.length) tests.push((p) => phones.every((ph) => p.phones.includes(ph)));
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

  onsetOf(input) {
    const w = input.toLowerCase();
    if (/^[a-z]{1,4}$/.test(w) && !this.lex.phones.has(w)) return lettersToPhones(w);
    const p = this.phon(w);
    if (p?.onset?.length) return [p.onset[0]];
    if (/^[a-z]+$/.test(w)) return lettersToPhones(w[0]);
    return null;
  }

  stressedVowelOf(input) {
    const up = input.toUpperCase().trim();
    if (/^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)$/.test(up)) return up;
    return this.phon(input.toLowerCase())?.stressedVowel ?? null;
  }

  // ---- main entry ----------------------------------------------------------

  search({ seeds = [], constraints = {}, limit = 120 }) {
    const { tests, soft } = this.compileConstraints(constraints);
    const hasConstraints = tests.length > 0 || soft.length > 0;
    const results = [];

    const consider = (word, base) => {
      const info = this.info(word);
      if (!info) return;
      const p = info.phon;
      for (const t of tests) if (!t(p, word)) return;
      let score = base.score;
      for (const s of soft) score += s(p) * 0.8;
      // Prefer common words a little (log-scaled), unless the user asked rare.
      const rank = info.freqRank ?? 200000;
      if (constraints.rarity === 'rare') {
        if (rank < 8000) return;
        score += Math.log10(rank) * 0.1;
      } else {
        if (constraints.rarity === 'common' && rank > 5000) return;
        score += (5.4 - Math.log10(rank)) * 0.12;
      }
      if (constraints.origin && info.ety.origin !== constraints.origin) return;
      if (constraints.feel === 'concrete' && !(info.conc >= 350)) return;
      if (constraints.feel === 'abstract' && !(info.conc != null && info.conc <= 260)) return;
      results.push({ word, score, info, reasons: [...base.reasons] });
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
    results.sort((a, b) => b.score - a.score ||
      (a.info.freqRank ?? 1e9) - (b.info.freqRank ?? 1e9));
    return results.slice(0, limit);
  }
}
