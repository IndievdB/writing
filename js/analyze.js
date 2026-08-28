// The analysis engine: turns text + lexicon into per-sentence metrics,
// located findings, and rolled-up category scores.
//
// Design: every metric is normalized to a 0–100 "smoothness" score against a
// calibrated band (some clash, some Latinate, some length variety is GOOD —
// the target is a band, not zero). Findings are generated only where a metric
// crosses a threshold, and every finding is anchored to exact source spans.
import { tokenize, splitSentences } from './tokenize.js?v=33';
import { analyzeWord, syllabify, syllableInfo } from './phonology.js?v=33';
import { classifyOrigin } from './etymology.js?v=33';
import {
  FUNCTION_WORDS, COORDINATORS, SUBORDINATORS, BE_FORMS, WEAK_VERBS, FILLERS,
  IRREGULAR_PARTICIPLES, SUBJECT_PRONOUNS,
} from './wordlists.js?v=33';

// ---------------------------------------------------------------------------
// Scoring helpers

// 100 inside [idealLo, idealHi]; linear falloff to 0 at [hardLo, hardHi].
export function bandScore(x, [idealLo, idealHi], [hardLo, hardHi]) {
  if (x == null || Number.isNaN(x)) return null;
  if (x >= idealLo && x <= idealHi) return 100;
  if (x < idealLo) {
    if (x <= hardLo) return 0;
    return Math.round(100 * (x - hardLo) / (idealLo - hardLo));
  }
  if (x >= hardHi) return 0;
  return Math.round(100 * (hardHi - x) / (hardHi - idealHi));
}

const SEV = { info: 0, minor: 1, moderate: 2, major: 3 };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const sd = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};
const r1 = (x) => Math.round(x * 10) / 10;
const pct = (x) => `${Math.round(x * 100)}%`;

// ---------------------------------------------------------------------------
// POS resolution: closed-class list first, then suffix cues, then the lexicon
// letter-set with a priority order informed by the neighboring word.

const FUNCTION_POS = (w) => {
  if (BE_FORMS.has(w) || ['have', 'has', 'had', 'do', 'does', 'did'].includes(w)) return 'V';
  if (['will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must'].includes(w)) return 'M';
  if (COORDINATORS.has(w)) return 'C';
  if (SUBORDINATORS.has(w)) return 'P';
  if (['a', 'an', 'the', 'this', 'that', 'these', 'those', 'some', 'any', 'each', 'every', 'no', 'another'].includes(w)) return 'D';
  if (SUBJECT_PRONOUNS.has(w) || w.endsWith('self') || w.endsWith('selves')) return 'O';
  if (['not', 'very', 'just', 'only', 'too', 'also', 'then', 'here', 'there', 'still', 'even'].includes(w)) return 'R';
  return 'P';
};

function resolvePos(ann, i) {
  const w = ann[i].lower;
  const set = ann[i].posSet;
  if (FUNCTION_WORDS.has(w)) return FUNCTION_POS(w);
  if (w.endsWith('ly') && (set.includes('R') || !set)) return 'R';
  const next = ann[i + 1];
  const nextNouny = next && !next.isFunction && next.posSet.includes('N');
  if (set.includes('J') && nextNouny) return 'J';
  if ((w.endsWith('ing') || w.endsWith('ed')) && set.includes('V') && !nextNouny) return 'V';
  // Contextual disambiguation (ann[i-1].pos is already resolved):
  const prevPos = ann[i - 1]?.pos;
  if (set.includes('V') && (prevPos === 'N' || prevPos === 'O')) return 'V';
  if (set.includes('J') && (prevPos === 'V' || prevPos === 'M')) return 'J';
  for (const c of ['N', 'V', 'J', 'R', 'U', 'E']) if (set.includes(c)) return c;
  // Unknown word: guess from suffix.
  if (w.endsWith('ly')) return 'R';
  if (/(tion|sion|ment|ness|ance|ence|ity|ism|ship|hood)s?$/.test(w)) return 'N';
  if (/(ize|ise|ate|ify)s?$/.test(w) || /(ed|ing)$/.test(w)) return 'V';
  if (/(ous|ive|able|ible|ful|less|ish|al|ic)$/.test(w)) return 'J';
  return 'N';
}

const isContent = (a) => !a.isFunction && ['N', 'V', 'J', 'R'].includes(a.pos);
const isStressed = (s) => s === 1 || s === 2;

function lemma(w) {
  let x = w.toLowerCase().replace(/[’']/g, "'").replace(/'s$/, '');
  if (x.endsWith('ies') && x.length > 4) return x.slice(0, -3) + 'y';
  if (x.endsWith('es') && x.length > 4) return x.slice(0, -2);
  if (x.endsWith('s') && !x.endsWith('ss') && x.length > 3) return x.slice(0, -1);
  return x;
}

// ---------------------------------------------------------------------------

export function analyzeText(text, lexicon) {
  const tokens = tokenize(text);
  const sentenceTokenGroups = splitSentences(tokens);
  const sentences = sentenceTokenGroups.map((toks, si) => analyzeSentence(toks, si, lexicon));

  const findings = sentences.flatMap((s) => s.findings);
  addMultiSentenceFindings(sentences, findings);

  const scores = rollUpScores(sentences);
  const readability = computeReadability(sentences);
  findings.sort((a, b) => SEV[b.severity] - SEV[a.severity] || a.spans[0]?.start - b.spans[0]?.start);

  return { text, tokens, sentences, findings, scores, readability };
}

// ---------------------------------------------------------------------------

function annotateWords(toks, lexicon) {
  const words = toks.filter((t) => t.kind === 'word' || t.kind === 'number');
  const ann = words.map((t) => {
    const lower = t.value.toLowerCase().replace(/’/g, "'");
    if (t.kind === 'number') {
      const syll = Math.max(1, t.value.replace(/\D/g, '').length);
      return {
        token: t, lower, isNumber: true, isFunction: false, posSet: 'E',
        phon: { oov: true, syllableCount: syll, stresses: Array(syll).fill(0).map((_, i) => (i === 0 ? 1 : 0)), onsetSize: 0, codaSize: 0, onsetKey: null, phones: [], counts: null },
        freqRank: null, conc: null,
      };
    }
    const phones = lexicon.phonesFor(lower);
    const posSet = lexicon.posFor(lower);
    const phon = analyzeWord(t.value, phones, posSet);
    return {
      token: t, lower, isNumber: false, isFunction: phon.isFunction,
      posSet: posSet || '', phon,
      freqRank: lexicon.freqRank(lower),
      conc: lexicon.concretenessFor(lower),
    };
  });
  ann.forEach((a, i) => { a.pos = a.isNumber ? 'E' : resolvePos(ann, i); });
  ann.forEach((a) => {
    a.ety = a.isNumber ? { origin: 'neutral', confidence: 0, swap: null }
      : classifyOrigin(a.lower, { syllableCount: a.phon.syllableCount, freqRank: a.freqRank });
    a.lemma = lemma(a.lower);
  });
  return ann;
}

// Syllable sequence with word links + pause marks (for rhythm metrics & UI).
function buildSyllables(toks, ann) {
  const sylls = [];
  let w = 0;
  for (const t of toks) {
    if (t.kind === 'pause' || t.kind === 'terminal') {
      if (sylls.length) sylls[sylls.length - 1].pauseAfter = true;
      continue;
    }
    if (t.kind !== 'word' && t.kind !== 'number') continue;
    const a = ann[w++];
    const groups = syllabify(a.phon.phones ?? []);
    a.phon.stresses.forEach((s, i) => {
      const ph = groups[i] ?? [];
      const { nucleus, dur } = syllableInfo(ph, s >= 1);
      sylls.push({
        wordIndex: w - 1, stress: s,
        first: i === 0, last: i === a.phon.stresses.length - 1,
        pauseAfter: false,
        phones: ph, nucleus, dur,
      });
    });
  }
  return sylls;
}

function span(a) { return { start: a.token.start, end: a.token.end }; }
function spanRange(a, b) { return { start: a.token.start, end: b.token.end }; }

// ---------------------------------------------------------------------------

function analyzeSentence(toks, sentenceIndex, lexicon) {
  const ann = annotateWords(toks, lexicon);
  const sylls = buildSyllables(toks, ann);
  const findings = [];
  const metrics = [];
  const marks = { clashes: [], lapses: [], junctions: [], sound: [] };
  const addMetric = (m) => metrics.push(m);
  const addFinding = (f) => findings.push({ sentenceIndex, ...f });

  const content = ann.filter(isContent);
  const nWords = ann.length;
  const nSyll = sylls.length;

  // ============================ RHYTHM ============================

  // Stress clash across word boundaries.
  let clashes = 0;
  for (let i = 0; i + 1 < sylls.length; i++) {
    const a = sylls[i], b = sylls[i + 1];
    if (a.last && b.first && a.wordIndex !== b.wordIndex && !a.pauseAfter &&
        isStressed(a.stress) && isStressed(b.stress)) {
      clashes++;
      marks.clashes.push([a.wordIndex, b.wordIndex]);
      if (a.stress === 1 && b.stress === 1) {
        const wa = ann[a.wordIndex], wb = ann[b.wordIndex];
        addFinding({
          severity: 'moderate', category: 'rhythm', id: 'clash',
          title: 'Stress clash',
          message: `“${wa.token.value} ${wb.token.value}” puts two beats back-to-back — the reader's inner voice has to punch twice with no pickup between.`,
          suggestion: 'Slip an unstressed word between them, or swap one for a word stressed on a different syllable.',
          spans: [spanRange(wa, wb)],
        });
      }
    }
  }
  const clashRate = nSyll > 1 ? clashes / (nSyll / 10) : 0;
  addMetric({
    id: 'clash', category: 'rhythm', label: 'Stress clashes',
    value: `${clashes} (${r1(clashRate)}/10 syll)`,
    score: bandScore(clashRate, [0, 0.8], [0, 3.0]), weight: 3,
  });

  // Stress lapses: 3+ unstressed in a row.
  let lapses = 0, runStart = 0, unstr = 0, longestLapse = 0;
  for (let i = 0; i <= sylls.length; i++) {
    const s = sylls[i];
    if (s && !isStressed(s.stress)) { if (unstr === 0) runStart = i; unstr++; }
    else {
      if (unstr >= 4) {
        lapses++;
        longestLapse = Math.max(longestLapse, unstr);
        const wa = ann[sylls[runStart].wordIndex], wb = ann[sylls[i - 1].wordIndex];
        marks.lapses.push([sylls[runStart].wordIndex, sylls[i - 1].wordIndex]);
        addFinding({
          severity: unstr >= 6 ? 'moderate' : 'minor', category: 'rhythm', id: 'lapse',
          title: 'Stress lapse',
          message: `${unstr} unstressed syllables in a row (“${wa.token.value} … ${wb.token.value}”) — the sentence mumbles here, usually a chain of little grammar words.`,
          suggestion: 'Cut function words or replace the chain with one concrete stressed word.',
          spans: [spanRange(wa, wb)],
        });
      }
      unstr = 0;
    }
  }
  addMetric({
    id: 'lapse', category: 'rhythm', label: 'Stress lapses (4+ slack syllables)',
    value: String(lapses),
    score: bandScore(lapses / Math.max(1, nSyll / 12), [0, 0.5], [0, 2]), weight: 2,
  });

  // Metrical regularity: agreement of the binary stress sequence with itself
  // at lag 2 (duple meter) / lag 3 (triple meter).
  const bin = sylls.map((s) => (isStressed(s.stress) ? 1 : 0));
  const agree = (lag) => {
    if (bin.length <= lag) return 0.5;
    let same = 0;
    for (let i = 0; i + lag < bin.length; i++) if (bin[i] === bin[i + lag]) same++;
    return same / (bin.length - lag);
  };
  const regularity = Math.max(agree(2), agree(3));
  addMetric({
    id: 'regularity', category: 'rhythm', label: 'Metrical regularity',
    value: pct(regularity),
    // Sweet spot: loosely metrical. Too low = jumbled, too high = sing-song.
    // Too few syllables and the statistic is noise — don't score it.
    score: nSyll >= 8 ? bandScore(regularity, [0.55, 0.85], [0.25, 1.01]) : null,
    weight: 1.5,
  });

  // Inter-stress interval burstiness (isochrony proxy).
  const beats = [];
  bin.forEach((b, i) => { if (b) beats.push(i); });
  const intervals = beats.slice(1).map((b, i) => b - beats[i]);
  const cv = intervals.length >= 3 && mean(intervals) > 0 ? sd(intervals) / mean(intervals) : null;
  addMetric({
    id: 'isochrony', category: 'rhythm', label: 'Beat spacing evenness (CV)',
    value: cv == null ? '—' : r1(cv).toFixed(1),
    score: cv == null ? null : bandScore(cv, [0, 0.65], [0, 1.4]), weight: 1,
  });

  // Monosyllable runs.
  let maxMono = 0, cur = 0, monoStart = 0, bestMono = null;
  ann.forEach((a, i) => {
    if (a.phon.syllableCount === 1) {
      if (cur === 0) monoStart = i;
      cur++;
      if (cur > maxMono) { maxMono = cur; bestMono = [monoStart, i]; }
    } else cur = 0;
  });
  if (maxMono >= 6) {
    addFinding({
      severity: maxMono >= 8 ? 'moderate' : 'minor', category: 'rhythm', id: 'mono-run',
      title: 'Monosyllable run',
      message: `${maxMono} one-syllable words in a row — every word gets its own thud, which reads as staccato.`,
      suggestion: 'Fold two short words into one longer one, or let a clause breathe with a comma.',
      spans: [spanRange(ann[bestMono[0]], ann[bestMono[1]])],
    });
  }
  addMetric({
    id: 'mono-run', category: 'rhythm', label: 'Longest monosyllable run',
    value: String(maxMono),
    score: bandScore(maxMono, [0, 5], [0, 12]), weight: 1.5,
  });

  // Polysyllable clustering.
  let polyAdj = 0;
  for (let i = 0; i + 1 < ann.length; i++) {
    if (ann[i].phon.syllableCount >= 3 && ann[i + 1].phon.syllableCount >= 3) {
      polyAdj++;
      addFinding({
        severity: 'minor', category: 'rhythm', id: 'poly-cluster',
        title: 'Long-word pileup',
        message: `“${ann[i].token.value} ${ann[i + 1].token.value}” — back-to-back long words turn the line to sludge.`,
        suggestion: 'Keep one; replace or move the other.',
        spans: [spanRange(ann[i], ann[i + 1])],
      });
    }
  }
  const sylPerWord = nWords ? nSyll / nWords : 0;
  addMetric({
    id: 'syl-word', category: 'rhythm', label: 'Syllables per word',
    value: r1(sylPerWord).toFixed(1),
    score: bandScore(sylPerWord, [1.2, 1.7], [1.0, 2.4]), weight: 2,
  });

  // Cadence: how the sentence ends.
  const lastSyll = sylls[sylls.length - 1];
  const cadence = lastSyll ? (isStressed(lastSyll.stress) ? 'stressed (lands)' : 'unstressed (trails)') : '—';
  addMetric({
    id: 'cadence', category: 'rhythm', label: 'Final cadence',
    value: cadence, score: null, weight: 0,
  });

  // ============================ SOUND ============================

  const contentIdx = ann.map((a, i) => i).filter((i) => isContent(ann[i]) && !ann[i].isNumber);

  // Boundary junctions between adjacent words (no pause between).
  let worstJunction = 0, junctionSum = 0, junctionCount = 0, geminates = 0, hiatus = 0;
  const wordPauseAfter = new Set();
  sylls.forEach((s) => { if (s.pauseAfter && s.last) wordPauseAfter.add(s.wordIndex); });
  for (let i = 0; i + 1 < ann.length; i++) {
    if (wordPauseAfter.has(i)) continue;
    const A = ann[i].phon, B = ann[i + 1].phon;
    if (ann[i].isNumber || ann[i + 1].isNumber) continue;
    const size = (A.codaSize ?? 0) + (B.onsetSize ?? 0);
    junctionSum += size; junctionCount++;
    if (size > worstJunction) worstJunction = size;
    if (size >= 5) {
      marks.junctions.push([i, i + 1]);
      addFinding({
        severity: size >= 6 ? 'moderate' : 'minor', category: 'sound', id: 'junction',
        title: 'Consonant pileup at word seam',
        message: `“${ann[i].token.value} ${ann[i + 1].token.value}” jams ${size} consonants together at the boundary — a tongue-twister seam readers stumble on even silently.`,
        suggestion: 'Reorder so a vowel-heavy word sits between them, or pick a synonym with a gentler opening.',
        spans: [spanRange(ann[i], ann[i + 1])],
      });
    }
    const lastPhone = A.phones?.[A.phones.length - 1];
    const firstPhone = B.phones?.[0];
    if (lastPhone && firstPhone && lastPhone === firstPhone) {
      geminates++;
      if (!ann[i].isFunction || !ann[i + 1].isFunction) {
        addFinding({
          severity: 'minor', category: 'sound', id: 'geminate',
          title: 'Doubled sound at word seam',
          message: `“${ann[i].token.value} ${ann[i + 1].token.value}” ends and begins with the same sound — the words smear together or force an awkward hitch.`,
          suggestion: 'Swap one word or reorder the phrase.',
          spans: [spanRange(ann[i], ann[i + 1])],
        });
      }
    }
    if ((A.codaSize ?? 1) === 0 && (B.onsetSize ?? 1) === 0 && !A.oov && !B.oov) hiatus++;
  }
  const avgJunction = junctionCount ? junctionSum / junctionCount : 0;
  addMetric({
    id: 'junction', category: 'sound', label: 'Avg consonants per word seam',
    value: `${r1(avgJunction).toFixed(1)} (max ${worstJunction})`,
    score: bandScore(avgJunction, [0, 2.2], [0, 4.2]), weight: 3,
  });
  addMetric({
    id: 'hiatus', category: 'sound', label: 'Vowel–vowel seams (hiatus)',
    value: String(hiatus),
    score: bandScore(hiatus / Math.max(1, junctionCount), [0, 0.12], [0, 0.4]), weight: 0.5,
  });

  // Alliteration / assonance within a sliding window of 3 content words.
  const seenPairs = new Set();
  for (let ci = 0; ci < contentIdx.length; ci++) {
    for (let cj = ci + 1; cj < Math.min(ci + 3, contentIdx.length); cj++) {
      const A = ann[contentIdx[ci]], B = ann[contentIdx[cj]];
      if (A.lemma === B.lemma) continue;
      const pairKey = `${contentIdx[ci]}-${contentIdx[cj]}`;
      const aOn = A.phon.onset?.[0], bOn = B.phon.onset?.[0];
      if (aOn && bOn && aOn === bOn && !seenPairs.has('al' + pairKey)) {
        seenPairs.add('al' + pairKey);
        marks.sound.push({ kind: 'alliteration', words: [contentIdx[ci], contentIdx[cj]], key: aOn });
      }
      const aV = A.phon.stressedVowel, bV = B.phon.stressedVowel;
      if (aV && bV && aV === bV && !seenPairs.has('as' + pairKey)) {
        seenPairs.add('as' + pairKey);
        marks.sound.push({ kind: 'assonance', words: [contentIdx[ci], contentIdx[cj]], key: aV });
      }
    }
  }
  const allitPairs = marks.sound.filter((s) => s.kind === 'alliteration').length;
  const assonPairs = marks.sound.filter((s) => s.kind === 'assonance').length;
  const allitRate = contentIdx.length > 1 ? allitPairs / contentIdx.length : 0;
  if (allitPairs >= 3 && allitRate > 0.4) {
    const involved = [...new Set(marks.sound.filter((s) => s.kind === 'alliteration').flatMap((s) => s.words))];
    addFinding({
      severity: 'minor', category: 'sound', id: 'alliteration',
      title: 'Heavy alliteration',
      message: `${allitPairs} pairs of nearby words share their opening sound. Deliberate alliteration binds a phrase; this much of it starts to chime.`,
      suggestion: 'Keep the one pair you meant; vary the openings of the rest.',
      spans: involved.map((i) => span(ann[i])),
    });
  }
  addMetric({
    id: 'alliteration', category: 'sound', label: 'Alliterating near-pairs',
    value: String(allitPairs),
    score: bandScore(allitRate, [0, 0.35], [0, 1.0]), weight: 1,
  });
  addMetric({
    id: 'assonance', category: 'sound', label: 'Assonant near-pairs',
    value: String(assonPairs),
    score: bandScore(contentIdx.length ? assonPairs / contentIdx.length : 0, [0, 0.4], [0, 1.1]), weight: 0.5,
  });

  // Accidental rhyme within 8 words.
  for (let ci = 0; ci < contentIdx.length; ci++) {
    for (let cj = ci + 1; cj < contentIdx.length; cj++) {
      const iA = contentIdx[ci], iB = contentIdx[cj];
      if (iB - iA > 8) break;
      const A = ann[iA], B = ann[iB];
      if (A.lemma === B.lemma) continue;
      const rk = A.phon.rhymeKey;
      if (rk && rk === B.phon.rhymeKey && rk.split(' ').length >= 2) {
        addFinding({
          severity: 'minor', category: 'sound', id: 'rhyme',
          title: 'Accidental rhyme',
          message: `“${A.token.value}” and “${B.token.value}” rhyme. In prose an unmeant rhyme rings a little bell that yanks attention off the meaning.`,
          suggestion: 'Replace one with a non-rhyming synonym.',
          spans: [span(A), span(B)],
        });
      }
    }
  }

  // Phoneme-class texture.
  const totals = { phones: 0, cons: 0, sib: 0, plo: 0, liq: 0, nas: 0, gli: 0, bright: 0, dark: 0, vow: 0 };
  for (const a of ann) {
    const c = a.phon.counts;
    if (!c) continue;
    totals.phones += c.phones; totals.cons += c.consonants; totals.sib += c.sibilants;
    totals.plo += c.plosives; totals.liq += c.liquids; totals.nas += c.nasals;
    totals.gli += c.glides; totals.bright += c.brightVowels; totals.dark += c.darkVowels;
    totals.vow += c.vowels;
  }
  const sibRate = totals.phones ? totals.sib / totals.phones : 0;
  const ploRate = totals.phones ? totals.plo / totals.phones : 0;
  const euphony = totals.cons ? (totals.liq + totals.nas + totals.gli) / totals.cons : 0;
  if (sibRate > 0.18 && totals.phones > 15) {
    const hissy = ann.filter((a) => a.phon.counts && a.phon.counts.sibilants >= 2);
    addFinding({
      severity: 'minor', category: 'sound', id: 'sibilance',
      title: 'Hissy sentence',
      message: `${pct(sibRate)} of the sounds are s/z/sh-type hisses (typical prose sits near 11%).`,
      suggestion: 'Swap one or two of the s-heavy words for quieter synonyms.',
      spans: hissy.slice(0, 4).map(span),
    });
  }
  addMetric({
    id: 'sibilance', category: 'sound', label: 'Sibilance (s/z/sh sounds)',
    value: pct(sibRate),
    score: bandScore(sibRate, [0, 0.15], [0, 0.28]), weight: 1,
  });
  addMetric({
    id: 'plosives', category: 'sound', label: 'Plosives (p/t/k/b/d/g)',
    value: pct(ploRate),
    score: bandScore(ploRate, [0, 0.24], [0, 0.4]), weight: 1,
  });
  addMetric({
    id: 'euphony', category: 'sound', label: 'Soft consonants (l/r/m/n/w/y)',
    value: pct(euphony),
    score: bandScore(euphony, [0.28, 1], [0.05, 1.01]), weight: 1,
  });
  addMetric({
    id: 'vowel-color', category: 'sound', label: 'Vowel color (bright : dark)',
    value: `${totals.bright} : ${totals.dark}`, score: null, weight: 0,
  });
  const clusterLoad = mean(ann.filter((a) => !a.phon.oov).map((a) => a.phon.maxConsonantRun || 0));
  addMetric({
    id: 'clusters', category: 'sound', label: 'Consonant cluster load',
    value: r1(clusterLoad).toFixed(1),
    score: bandScore(clusterLoad, [0, 1.9], [0, 3.2]), weight: 1,
  });

  // Word repetition & echoed endings.
  const SUFFIX_ECHOES = ['tion', 'sion', 'ment', 'ing', 'ness', 'ity', 'ly', 'ance', 'ence'];
  for (let i = 0; i < ann.length; i++) {
    for (let j = i + 1; j < Math.min(i + 9, ann.length); j++) {
      const A = ann[i], B = ann[j];
      if (isContent(A) && A.lemma === B.lemma && A.lemma.length > 2) {
        addFinding({
          severity: j - i <= 4 ? 'moderate' : 'minor', category: 'sound', id: 'repeat',
          title: 'Repeated word',
          message: `“${A.token.value}” appears twice within ${j - i} words. Unless the echo is deliberate, the second one clunks.`,
          suggestion: 'Cut one, or use a pronoun or synonym.',
          spans: [span(A), span(B)],
        });
      }
    }
  }
  for (const suf of SUFFIX_ECHOES) {
    const hits = ann.filter((a) => isContent(a) && a.lower.length > suf.length + 2 && a.lower.endsWith(suf));
    for (let k = 0; k + 1 < hits.length; k++) {
      const A = hits[k], B = hits[k + 1];
      const dist = ann.indexOf(B) - ann.indexOf(A);
      if (dist <= 6 && A.lemma !== B.lemma) {
        addFinding({
          severity: 'minor', category: 'sound', id: 'echo',
          title: `Echoed “-${suf}” endings`,
          message: `“${A.token.value} … ${B.token.value}” — two “-${suf}” words close together set up a jingle.`,
          suggestion: 'Recast one of them (often the fix is a verb instead of a noun).',
          spans: [span(A), span(B)],
        });
      }
    }
  }

  // ============================ LEXIS ============================

  // Only unassimilated Latinate counts toward "heavy diction": short, common
  // loans (change, people, money) read as plain English; the register problem
  // is the polysyllabic or uncommon borrowings.
  const latinate = content.filter((a) => a.ety.origin === 'latinate' &&
    (a.phon.syllableCount >= 3 || a.freqRank == null || a.freqRank > 5000));
  const latRate = content.length ? latinate.length / content.length : 0;
  for (const a of content) {
    if (a.ety.swap) {
      addFinding({
        severity: 'minor', category: 'lexis', id: 'swap',
        title: 'Plainer word available',
        message: `“${a.token.value}” is doing formal-Latinate work a plain word does better.`,
        suggestion: `Try “${a.ety.swap}”.`,
        spans: [span(a)],
      });
    }
  }
  if (latRate > 0.45 && content.length >= 5) {
    addFinding({
      severity: 'moderate', category: 'lexis', id: 'latinate',
      title: 'Latinate-heavy diction',
      message: `${pct(latRate)} of the content words are Latinate borrowings — the register drifts abstract and official, and the syllable count balloons.`,
      suggestion: 'Swap the least necessary ones for short Anglo-Saxon words; keep the ones that carry precise meaning.',
      spans: latinate.slice(0, 5).map(span),
    });
  }
  addMetric({
    id: 'latinate', category: 'lexis', label: 'Latinate share of content words',
    value: pct(latRate),
    score: bandScore(latRate, [0, 0.35], [0, 0.7]), weight: 2.5,
  });

  const concVals = content.map((a) => a.conc).filter((c) => c != null);
  const concMean = concVals.length ? mean(concVals) / 100 : null;
  if (concMean != null) {
    const abstracts = content.filter((a) => a.conc != null && a.conc < 250);
    if (concMean < 2.6 && content.length >= 5) {
      addFinding({
        severity: 'moderate', category: 'lexis', id: 'abstract',
        title: 'Abstract diction',
        message: `Average concreteness is ${r1(concMean)}/5 — the sentence lives in concept-space. Readers hold concrete words far more easily.`,
        suggestion: 'Anchor the sentence with at least one thing you could photograph.',
        spans: abstracts.slice(0, 4).map(span),
      });
    }
    addMetric({
      id: 'concreteness', category: 'lexis', label: 'Concreteness (1–5)',
      value: r1(concMean).toFixed(1),
      score: bandScore(concMean, [3.0, 5], [1.8, 5.1]), weight: 1.5,
    });
  }

  const ranks = content.map((a) => a.freqRank).filter((r) => r != null);
  const meanLogRank = ranks.length ? mean(ranks.map((r) => Math.log10(r))) : null;
  const rare = content.filter((a) => (a.freqRank == null && !a.isNumber && a.phon.oov) || (a.freqRank != null && a.freqRank > 40000));
  for (const a of rare.slice(0, 4)) {
    addFinding({
      severity: 'info', category: 'lexis', id: 'rare',
      title: 'Rare word',
      message: `“${a.token.value}” is uncommon — readers pay a measurable time-tax on rare words. Fine if it's the exact word; costly if a common one would do.`,
      suggestion: null,
      spans: [span(a)],
    });
  }
  if (meanLogRank != null) {
    addMetric({
      id: 'rarity', category: 'lexis', label: 'Word rarity (mean log rank)',
      value: r1(meanLogRank).toFixed(1),
      score: bandScore(meanLogRank, [0, 3.3], [0, 4.6]), weight: 1,
    });
  }

  const density = nWords ? content.length / nWords : 0;
  addMetric({
    id: 'density', category: 'lexis', label: 'Lexical density (content words)',
    value: pct(density),
    score: bandScore(density, [0.38, 0.62], [0.15, 0.85]), weight: 1,
  });

  let fillerCount = 0;
  ann.forEach((a, i) => {
    const isKindSortOf = (a.lower === 'kind' || a.lower === 'sort') && ann[i + 1]?.lower === 'of';
    if ((FILLERS.has(a.lower) && a.lower !== 'kind' && a.lower !== 'sort') || isKindSortOf) {
      fillerCount++;
      addFinding({
        severity: 'minor', category: 'lexis', id: 'filler',
        title: 'Filler / intensifier',
        message: `“${a.token.value}${isKindSortOf ? ' of' : ''}” adds syllables, not meaning — intensifiers usually weaken the word they lean on.`,
        suggestion: 'Cut it, or replace the pair with one stronger word.',
        spans: [isKindSortOf ? spanRange(a, ann[i + 1]) : span(a)],
      });
    }
  });
  addMetric({
    id: 'fillers', category: 'lexis', label: 'Fillers & intensifiers',
    value: String(fillerCount),
    score: bandScore(fillerCount / Math.max(1, nWords / 10), [0, 0.4], [0, 2]), weight: 1,
  });

  // ============================ SYNTAX ============================

  // Modifier pileups: runs of adjectives/adverbs.
  let runStart2 = -1;
  const flushModRun = (endIdx) => {
    if (runStart2 < 0) return;
    const len = endIdx - runStart2;
    if (len >= 2) {
      const A = ann[runStart2], B = ann[endIdx - 1];
      addFinding({
        severity: len >= 3 ? 'moderate' : 'minor', category: 'syntax', id: 'modifiers',
        title: 'Modifier pileup',
        message: `${len} modifiers stacked (“${ann.slice(runStart2, endIdx).map((x) => x.token.value).join(' ')}”) — each one delays the noun and dilutes the others.`,
        suggestion: 'Keep the one modifier that matters; let a sharper noun absorb the rest.',
        spans: [spanRange(A, B)],
      });
    }
    runStart2 = -1;
  };
  ann.forEach((a, i) => {
    const isMod = (a.pos === 'J' || (a.pos === 'R' && a.lower.endsWith('ly'))) && !a.isFunction;
    if (isMod) { if (runStart2 < 0) runStart2 = i; }
    else flushModRun(i);
  });
  flushModRun(ann.length);

  const lyAdverbs = content.filter((a) => a.pos === 'R' && a.lower.endsWith('ly'));
  addMetric({
    id: 'adverbs', category: 'syntax', label: '-ly adverbs',
    value: String(lyAdverbs.length),
    score: bandScore(lyAdverbs.length / Math.max(1, nWords / 10), [0, 0.5], [0, 2.5]), weight: 1,
  });

  // Noun stacks.
  let nounRun = 0, nounStart = 0;
  ann.forEach((a, i) => {
    if (a.pos === 'N' && !a.isFunction) {
      if (nounRun === 0) nounStart = i;
      nounRun++;
    } else {
      if (nounRun >= 3) {
        addFinding({
          severity: 'moderate', category: 'syntax', id: 'noun-stack',
          title: 'Noun stack',
          message: `${nounRun} nouns in a row (“${ann.slice(nounStart, i).map((x) => x.token.value).join(' ')}”) — readers must reverse-engineer which noun modifies which.`,
          suggestion: 'Unpack it with a preposition or a verb.',
          spans: [spanRange(ann[nounStart], ann[i - 1])],
        });
      }
      nounRun = 0;
    }
  });

  // Preposition chains ("of the X in the Y of the Z").
  const preps = ann.filter((a) => a.pos === 'P' && !SUBORDINATORS.has(a.lower));
  const ofChain = [];
  ann.forEach((a, i) => { if (a.lower === 'of') ofChain.push(i); });
  let chainedOfs = 0;
  for (let k = 0; k + 1 < ofChain.length; k++) if (ofChain[k + 1] - ofChain[k] <= 4) chainedOfs++;
  if (chainedOfs >= 1 && ofChain.length >= 2) {
    addFinding({
      severity: 'minor', category: 'syntax', id: 'prep-chain',
      title: 'Preposition chain',
      message: `Stacked “of … of …” phrases — each one adds a clause the reader must hold open before the meaning resolves.`,
      suggestion: 'Convert one “of” phrase to a possessive or find the buried verb.',
      spans: ofChain.slice(0, 3).map((i) => span(ann[i])),
    });
  }
  addMetric({
    id: 'preps', category: 'syntax', label: 'Preposition share',
    value: pct(nWords ? preps.length / nWords : 0),
    score: bandScore(nWords ? preps.length / nWords : 0, [0, 0.16], [0, 0.3]), weight: 1,
  });

  // Expletive opener.
  const firstWord = ann[0];
  if (firstWord && ['there', 'it'].includes(firstWord.lower) && ann[1] && BE_FORMS.has(ann[1].lower)) {
    addFinding({
      severity: 'minor', category: 'syntax', id: 'expletive',
      title: 'Empty opener',
      message: `“${firstWord.token.value} ${ann[1].token.value} …” spends the sentence's strongest position on a placeholder.`,
      suggestion: 'Start with the real subject: “There are three problems with X” → “X has three problems.”',
      spans: [spanRange(firstWord, ann[1])],
    });
  }

  // Passive approximation: be-form + (within 2 words) past participle.
  let passives = 0;
  ann.forEach((a, i) => {
    if (!BE_FORMS.has(a.lower)) return;
    for (let j = i + 1; j <= Math.min(i + 2, ann.length - 1); j++) {
      const b = ann[j];
      if (b.pos === 'R') continue;
      const participle = (/(ed|en)$/.test(b.lower) && b.posSet.includes('V')) || IRREGULAR_PARTICIPLES.has(b.lower);
      if (participle) {
        passives++;
        addFinding({
          severity: 'minor', category: 'syntax', id: 'passive',
          title: 'Passive construction',
          message: `“${a.token.value} ${ann.slice(i + 1, j + 1).map((x) => x.token.value).join(' ')}” — the actor is offstage and the verb loses its push.`,
          suggestion: 'If the actor matters, put them in front of an active verb.',
          spans: [spanRange(a, b)],
        });
      }
      break;
    }
  });

  // Weak verbs & nominalizations.
  const weakMain = ann.filter((a) => WEAK_VERBS.has(a.lower) && a.pos !== 'M');
  const nomins = content.filter((a) => a.pos === 'N' && /(tion|sion|ment|ance|ence|ency|ancy|ization|isation|ility)s?$/.test(a.lower));
  for (const a of nomins) {
    addFinding({
      severity: 'info', category: 'syntax', id: 'nominalization',
      title: 'Nominalization',
      message: `“${a.token.value}” is a verb wearing a noun costume — it usually drags a weak verb and a preposition along with it.`,
      suggestion: 'See if the buried verb can run the sentence (“made a decision” → “decided”).',
      spans: [span(a)],
    });
  }
  addMetric({
    id: 'weak-verbs', category: 'syntax', label: 'Weak verbs (be/have/make/get…)',
    value: String(weakMain.length),
    score: bandScore(weakMain.length / Math.max(1, nWords / 10), [0, 0.8], [0, 2.5]), weight: 1,
  });
  addMetric({
    id: 'nominalizations', category: 'syntax', label: 'Nominalizations',
    value: String(nomins.length),
    score: bandScore(nomins.length / Math.max(1, nWords / 10), [0, 0.5], [0, 2]), weight: 1,
  });

  // ============================ SHAPE ============================

  // Clause segmentation on pause punctuation + clause-linking conjunctions.
  const clauses = [];
  let clauseWords = 0;
  for (const t of toks) {
    if (t.kind === 'word' || t.kind === 'number') clauseWords++;
    if ((t.kind === 'pause' || t.kind === 'terminal') && clauseWords > 0) {
      clauses.push(clauseWords); clauseWords = 0;
    }
  }
  if (clauseWords > 0) clauses.push(clauseWords);
  const breathRuns = [];
  let breath = 0;
  for (const s of sylls) { breath++; if (s.pauseAfter) { breathRuns.push(breath); breath = 0; } }
  if (breath) breathRuns.push(breath);
  const maxBreath = breathRuns.length ? Math.max(...breathRuns) : 0;
  if (maxBreath > 32) {
    addFinding({
      severity: 'moderate', category: 'shape', id: 'breath',
      title: 'No place to breathe',
      message: `${maxBreath} syllables with no pause. Readers subvocalize — past ~30 syllables the inner voice runs out of air.`,
      suggestion: 'Add a comma-worthy joint, or split the sentence.',
      spans: firstWord ? [span(firstWord)] : [],
    });
  }
  addMetric({
    id: 'length', category: 'shape', label: 'Sentence length',
    value: `${nWords} words / ${nSyll} syllables`,
    score: bandScore(nWords, [4, 24], [1, 45]), weight: 1.5,
  });
  addMetric({
    id: 'breath', category: 'shape', label: 'Longest breath (syllables)',
    value: String(maxBreath),
    score: bandScore(maxBreath, [1, 30], [0, 48]), weight: 1.5,
  });
  const pauseRate = nWords ? clauses.length / nWords : 0;
  if (clauses.length >= 4 && mean(clauses) < 4) {
    addFinding({
      severity: 'moderate', category: 'shape', id: 'choppy-clauses',
      title: 'Chopped into fragments',
      message: `${clauses.length} clauses averaging ${r1(mean(clauses))} words — the sentence hiccups at every comma.`,
      suggestion: 'Merge the two clauses that belong together; keep one short clause for punch.',
      spans: firstWord ? [span(firstWord)] : [],
    });
  }
  addMetric({
    id: 'clauses', category: 'shape', label: 'Clauses (len avg / var)',
    value: clauses.length ? `${clauses.length} (${r1(mean(clauses))} ± ${r1(sd(clauses))})` : '1',
    // Negative hardLo keeps equal-length clauses (cv 0) at a decent score
    // rather than treating uniformity as a hard failure.
    score: clauses.length >= 2 ? bandScore(sd(clauses) / Math.max(1, mean(clauses)), [0.2, 1.2], [-0.5, 2.2]) : null,
    weight: 1,
  });

  // Polysyndeton: and...and...and
  const ands = ann.filter((a) => a.lower === 'and').length;
  if (ands >= 3) {
    addFinding({
      severity: 'minor', category: 'shape', id: 'polysyndeton',
      title: 'And… and… and',
      message: `${ands} “and”s — the sentence strings beads instead of building. Fine as a deliberate rush; monotone otherwise.`,
      suggestion: 'Subordinate one clause (“which…”, “because…”) or split.',
      spans: ann.filter((a) => a.lower === 'and').slice(0, 4).map(span),
    });
  }

  // Fragment check: any finite-verb candidate?
  const hasFinite = ann.some((a) =>
    (BE_FORMS.has(a.lower) || a.pos === 'M' ||
     (a.pos === 'V' && !/ing$/.test(a.lower))) && !a.isNumber);
  if (!hasFinite && nWords >= 3) {
    addFinding({
      severity: 'info', category: 'shape', id: 'fragment',
      title: 'Sentence fragment',
      message: 'No finite verb found — this reads as a fragment. Powerful when deliberate. Choppy when accidental.',
      suggestion: null,
      spans: firstWord ? [span(firstWord)] : [],
    });
  }

  return {
    tokens: toks, ann, sylls, clauses, metrics, findings, marks,
    stats: { nWords, nSyll, content: content.length },
  };
}

// ---------------------------------------------------------------------------
// Cross-sentence metrics (variety is a paragraph-scale phenomenon).

function addMultiSentenceFindings(sentences, findings) {
  if (sentences.length < 2) return;
  const lengths = sentences.map((s) => s.stats.nWords);
  const cv = mean(lengths) ? sd(lengths) / mean(lengths) : 0;

  // Monotone length: 3+ consecutive sentences within ±20% of each other.
  for (let i = 0; i + 2 < lengths.length; i++) {
    const trio = lengths.slice(i, i + 3);
    const m = mean(trio);
    if (m >= 4 && trio.every((l) => Math.abs(l - m) / m < 0.2)) {
      const first = sentences[i].ann[0];
      findings.push({
        sentenceIndex: i, severity: 'moderate', category: 'shape', id: 'monotone',
        title: 'Monotone sentence lengths',
        message: `Sentences ${i + 1}–${i + 3} are all ~${Math.round(m)} words. Same-length sentences in a row are the loudest form of choppiness — the paragraph marches in lockstep.`,
        suggestion: "Make one short. Make one long. (Gary Provost's trick: vary length like music.)",
        spans: first ? [{ start: first.token.start, end: first.token.end }] : [],
      });
      break;
    }
  }

  // Repeated openers: one finding per run, not one per adjacent pair.
  for (let i = 0; i + 1 < sentences.length; i++) {
    const a = sentences[i].ann[0], b = sentences[i + 1].ann[0];
    if (!a || !b || a.lemma !== b.lemma) continue;
    const prev = sentences[i - 1]?.ann[0];
    if (prev && prev.lemma === a.lemma) continue; // already inside a flagged run
    let runEnd = i + 1;
    while (runEnd + 1 < sentences.length && sentences[runEnd + 1].ann[0]?.lemma === a.lemma) runEnd++;
    const n = runEnd - i + 1;
    findings.push({
      sentenceIndex: i + 1, severity: n >= 3 ? 'moderate' : 'minor', category: 'shape', id: 'opener',
      title: 'Repeated sentence opener',
      message: `${n} sentences in a row open with “${a.token.value}”. Repeated openers make prose feel stamped out.`,
      suggestion: 'Invert one sentence, or start it from its object or a modifier.',
      spans: sentences.slice(i, runEnd + 1).map((s) => ({ start: s.ann[0].token.start, end: s.ann[0].token.end })),
    });
  }

  // Attach a variety metric to the last sentence's metric list (rolled up later).
  sentences[sentences.length - 1].metrics.push({
    id: 'variety', category: 'shape', label: 'Sentence-length variety (CV)',
    value: r1(cv).toFixed(2),
    score: bandScore(cv, [0.3, 1.0], [0.02, 1.8]), weight: 2,
  });
}

// ---------------------------------------------------------------------------

const CATEGORY_WEIGHTS = { rhythm: 0.28, sound: 0.24, lexis: 0.18, syntax: 0.15, shape: 0.15 };

function rollUpScores(sentences) {
  const byCat = {};
  for (const s of sentences) {
    for (const m of s.metrics) {
      if (m.score == null || !m.weight) continue;
      (byCat[m.category] ??= []).push({ score: m.score, weight: m.weight * Math.sqrt(s.stats.nWords || 1) });
    }
  }
  const cats = {};
  for (const [cat, arr] of Object.entries(byCat)) {
    const wsum = arr.reduce((s, x) => s + x.weight, 0);
    cats[cat] = Math.round(arr.reduce((s, x) => s + x.score * x.weight, 0) / wsum);
  }
  let overall = 0, wtot = 0, worst = 100;
  for (const [cat, w] of Object.entries(CATEGORY_WEIGHTS)) {
    if (cats[cat] != null) {
      overall += cats[cat] * w; wtot += w;
      worst = Math.min(worst, cats[cat]);
    }
  }
  // Flow is a weakest-link property: one broken dimension ruins a sentence
  // even when the others are healthy, so the floor drags the average.
  cats.overall = wtot ? Math.round(0.65 * (overall / wtot) + 0.35 * worst) : null;
  return cats;
}

function computeReadability(sentences) {
  const nSent = sentences.length || 1;
  let words = 0, syllables = 0, chars = 0, complex = 0, longWords = 0;
  for (const s of sentences) {
    for (const a of s.ann) {
      words++;
      syllables += a.phon.syllableCount;
      chars += a.lower.replace(/[^a-z0-9]/g, '').length;
      if (a.phon.syllableCount >= 3 && !a.isFunction) complex++;
      if (a.lower.length > 6) longWords++;
    }
  }
  if (!words) return null;
  const wps = words / nSent, spw = syllables / words;
  const fre = 206.835 - 1.015 * wps - 84.6 * spw;
  const fkg = 0.39 * wps + 11.8 * spw - 15.59;
  const fog = 0.4 * (wps + 100 * (complex / words));
  const smog = 1.043 * Math.sqrt(complex * (30 / nSent)) + 3.1291;
  const cli = 5.89 * (chars / words) - 0.3 * (nSent / words) * 100 - 15.8;
  const ari = 4.71 * (chars / words) + 0.5 * wps - 21.43;
  const lix = wps + 100 * (longWords / words);
  return {
    fleschEase: Math.round(fre), fkGrade: r1(fkg), fog: r1(fog),
    smog: r1(smog), colemanLiau: r1(cli), ari: r1(ari), lix: Math.round(lix),
    words, syllables, sentences: nSent,
  };
}
