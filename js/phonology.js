// Per-word phonological analysis on top of the CMU dictionary.
import { VOWELS, graphemeFallback } from './lexicon.js?v=33';
import { FUNCTION_WORDS } from './wordlists.js?v=33';

export const PLOSIVES = new Set(['P', 'B', 'T', 'D', 'K', 'G']);
export const AFFRICATES = new Set(['CH', 'JH']);
export const FRICATIVES = new Set(['F', 'V', 'TH', 'DH', 'S', 'Z', 'SH', 'ZH', 'HH']);
export const SIBILANTS = new Set(['S', 'Z', 'SH', 'ZH', 'CH', 'JH']);
export const NASALS = new Set(['M', 'N', 'NG']);
export const LIQUIDS = new Set(['L', 'R']);
export const GLIDES = new Set(['W', 'Y']);

// Perceptual "color" of vowels: front-high = bright/quick, back-low = dark/heavy.
export const BRIGHT_VOWELS = new Set(['IY', 'IH', 'EY', 'EH', 'AE']);
export const DARK_VOWELS = new Set(['AA', 'AO', 'OW', 'UH', 'UW', 'AW']);

const strip = (p) => p.replace(/\d/g, '');

// Analyze one word's phoneme string into the structure the metrics consume.
// posHint: category letters from the POS lexicon (may be '').
export function analyzeWord(word, phoneString, posHint = '') {
  const lower = word.toLowerCase();
  const isFunction = FUNCTION_WORDS.has(lower);
  if (!phoneString) return { ...graphemeFallback(word, isFunction), isFunction };

  const phones = phoneString.split(' ');
  const bare = phones.map(strip);
  const stresses = [];
  const vowelPhones = [];
  for (const p of phones) {
    const digit = p.match(/\d/);
    if (digit) {
      stresses.push(Number(digit[0]));
      vowelPhones.push(strip(p));
    }
  }
  const syllableCount = Math.max(1, stresses.length);

  // Prose-stress demotion: dictionary citation forms stress monosyllabic
  // function words ("of" -> AH1 V); in running prose they are unstressed.
  const proseStresses = stresses.slice();
  if (syllableCount === 1) proseStresses[0] = isFunction ? 0 : 1;

  const firstVowelIdx = phones.findIndex((p) => /\d/.test(p));
  const lastVowelIdx = phones.length - 1 - [...phones].reverse().findIndex((p) => /\d/.test(p));
  const onset = firstVowelIdx > 0 ? bare.slice(0, firstVowelIdx) : [];
  const coda = lastVowelIdx < phones.length - 1 ? bare.slice(lastVowelIdx + 1) : [];

  // Longest consonant run anywhere in the word (articulatory load).
  let maxRun = 0, run = 0;
  for (const p of bare) {
    if (VOWELS.has(p)) run = 0;
    else maxRun = Math.max(maxRun, ++run);
  }

  const consonants = bare.filter((p) => !VOWELS.has(p));
  const stressedVowel = vowelPhones[stresses.findIndex((s) => s === 1)] ??
    vowelPhones[stresses.findIndex((s) => s === 2)] ?? vowelPhones[0] ?? null;

  // Rhyme key: stressed vowel + everything after it (for accidental rhyme).
  let rhymeKey = null;
  let idx = phones.findIndex((p) => /1/.test(p));
  if (idx < 0) idx = phones.findIndex((p) => /\d/.test(p));
  if (idx >= 0) rhymeKey = bare.slice(idx).join(' ');

  return {
    oov: false,
    isFunction,
    phones: bare,
    rawPhones: phones,
    syllableCount,
    stresses: proseStresses,
    dictStresses: stresses,
    vowelPhones,
    stressedVowel,
    rhymeKey,
    onset,
    coda,
    onsetSize: onset.length,
    codaSize: coda.length,
    onsetKey: onset.length ? onset.join(' ') : null,
    maxConsonantRun: maxRun,
    counts: {
      phones: bare.length,
      vowels: vowelPhones.length,
      consonants: consonants.length,
      plosives: consonants.filter((p) => PLOSIVES.has(p)).length,
      sibilants: consonants.filter((p) => SIBILANTS.has(p)).length,
      fricatives: consonants.filter((p) => FRICATIVES.has(p)).length,
      nasals: consonants.filter((p) => NASALS.has(p)).length,
      liquids: consonants.filter((p) => LIQUIDS.has(p)).length,
      glides: consonants.filter((p) => GLIDES.has(p)).length,
      brightVowels: vowelPhones.filter((v) => BRIGHT_VOWELS.has(v)).length,
      darkVowels: vowelPhones.filter((v) => DARK_VOWELS.has(v)).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Prosody-lens helpers: split a word's phones into syllables and estimate
// each syllable's spoken duration (long nuclei and consonant codas stretch,
// stress stretches further).

const LONG_NUCLEI = new Set(['IY', 'UW', 'EY', 'OW', 'AY', 'AW', 'OY', 'AO', 'AA', 'ER']);

export function syllabify(phones) {
  const nuclei = [];
  phones.forEach((p, i) => { if (VOWELS.has(p)) nuclei.push(i); });
  if (!nuclei.length) return phones.length ? [phones.slice()] : [];
  const out = [];
  let start = 0;
  for (let k = 0; k < nuclei.length; k++) {
    let end;
    if (k === nuclei.length - 1) end = phones.length;
    else {
      // Consonants between nuclei: give one to the next onset, keep the rest.
      const gapStart = nuclei[k] + 1, gapEnd = nuclei[k + 1];
      end = gapEnd - gapStart === 0 ? gapStart : gapEnd - 1;
    }
    out.push(phones.slice(start, end));
    start = end;
  }
  return out;
}

export function syllableInfo(sylPhones, stressed) {
  const nucleus = sylPhones.find((p) => VOWELS.has(p)) ?? null;
  const nIdx = nucleus ? sylPhones.indexOf(nucleus) : sylPhones.length;
  let dur = 1;
  if (nucleus && LONG_NUCLEI.has(nucleus)) dur += 0.45;
  dur += 0.22 * Math.max(0, sylPhones.length - nIdx - 1); // coda consonants
  if (nIdx > 1) dur += 0.15;                              // onset cluster
  if (stressed) dur += 0.35;
  return { nucleus, dur };
}
