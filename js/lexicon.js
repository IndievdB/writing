// Lexicon: wraps the four data files (phonemes, POS, concreteness, frequency)
// and provides a grapheme-to-phoneme fallback for out-of-vocabulary words.
import { FUNCTION_WORDS } from './wordlists.js';

export const VOWELS = new Set([
  'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW',
  'OY', 'UH', 'UW',
]);

export class Lexicon {
  constructor() {
    this.phones = new Map();   // word -> "F OW1 N Z"
    this.pos = new Map();      // word -> "JN" category letters
    this.conc = new Map();     // word -> 100..500
    this.freq = new Map();     // word -> rank (1-based)
    this.ready = false;
  }

  // raws: {cmudict, pos, conc, freq} — raw text of each data file.
  load(raws) {
    for (const line of raws.cmudict.split('\n')) {
      const tab = line.indexOf('\t');
      if (tab > 0) this.phones.set(line.slice(0, tab), line.slice(tab + 1));
    }
    for (const line of raws.pos.split('\n')) {
      const tab = line.indexOf('\t');
      if (tab > 0) this.pos.set(line.slice(0, tab), line.slice(tab + 1));
    }
    for (const line of raws.conc.split('\n')) {
      const tab = line.indexOf('\t');
      if (tab > 0) this.conc.set(line.slice(0, tab), Number(line.slice(tab + 1)));
    }
    let rank = 1;
    for (const line of raws.freq.split('\n')) {
      const w = line.trim();
      if (w) this.freq.set(w, rank++);
    }
    this.ready = true;
  }

  // Phoneme string for a word, or null if OOV even after affix stripping.
  phonesFor(word) {
    const w = word.toLowerCase().replace(/’/g, "'");
    const direct = this.phones.get(w);
    if (direct) return direct;
    // Affix recovery: possessives, plurals, -ing/-ed built from a known stem.
    const tries = [];
    if (w.endsWith("'s")) tries.push([w.slice(0, -2), ' Z']);
    if (w.endsWith('s') && !w.endsWith('ss')) tries.push([w.slice(0, -1), ' Z']);
    if (w.endsWith('es')) tries.push([w.slice(0, -2), ' IH0 Z']);
    if (w.endsWith('ing')) {
      tries.push([w.slice(0, -3), ' IH0 NG']);
      tries.push([w.slice(0, -3) + 'e', ' IH0 NG']);
    }
    if (w.endsWith('ed')) {
      tries.push([w.slice(0, -2), ' D']);
      tries.push([w.slice(0, -1), ' D']);
    }
    if (w.endsWith('ly')) tries.push([w.slice(0, -2), ' L IY0']);
    if (w.endsWith('er')) {
      tries.push([w.slice(0, -2), ' ER0'], [w.slice(0, -1), ' ER0'], [w.slice(0, -3), ' ER0']);
    }
    if (w.endsWith('est')) {
      tries.push([w.slice(0, -3), ' IH0 S T'], [w.slice(0, -2), ' IH0 S T'], [w.slice(0, -4), ' IH0 S T']);
    }
    for (const [stem, suffix] of tries) {
      const p = this.phones.get(stem);
      if (p) return p + suffix;
    }
    if (/[- ]/.test(w)) {
      const parts = w.split(/[- ]+/).map((p) => this.phonesFor(p));
      if (parts.every(Boolean)) return parts.join(' ');
    }
    return null;
  }

  posFor(word) {
    return this.pos.get(word.toLowerCase()) || '';
  }

  concretenessFor(word) {
    // Exact form first — inflection only as fallback.
    return lookupInflected(this.conc, word, 'first');
  }

  freqRank(word) {
    // Best (smallest) rank across base forms — "hissed" is rare in subtitles
    // but "hiss" is not, and the base form is the honest rarity signal.
    return lookupInflected(this.freq, word, 'min');
  }
}

// Look up the word and plausible base forms (plural, -ed, -ing, -er/-est).
function lookupInflected(map, word, mode) {
  const w = word.toLowerCase();
  const stems = [w];
  if (w.endsWith('ies') && w.length > 4) stems.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es') && w.length > 3) stems.push(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) stems.push(w.slice(0, -1));
  if (w.endsWith('ied') && w.length > 4) stems.push(w.slice(0, -3) + 'y');
  if (w.endsWith('ed') && w.length > 4) {
    stems.push(w.slice(0, -2), w.slice(0, -1));
    if (/(.)\1ed$/.test(w)) stems.push(w.slice(0, -3)); // stopped -> stop
  }
  if (w.endsWith('ing') && w.length > 5) {
    stems.push(w.slice(0, -3), w.slice(0, -3) + 'e');
    if (/(.)\1ing$/.test(w)) stems.push(w.slice(0, -4)); // running -> run
  }
  if (w.endsWith('er') && w.length > 4) stems.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('est') && w.length > 5) stems.push(w.slice(0, -3), w.slice(0, -2));
  if (w.endsWith('ly') && w.length > 4) stems.push(w.slice(0, -2));
  let best = null;
  for (const s of stems) {
    const v = map.get(s);
    if (v == null) continue;
    if (mode === 'first') return v;
    if (best == null || v < best) best = v;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Grapheme fallback for OOV words: estimate syllable count and a stress guess.
// Deliberately conservative — most real words hit the dictionary.

export function estimateSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 1;
  let groups = (w.match(/[aeiouy]+/g) || []).length;
  if (w.endsWith('e') && !w.endsWith('le') && groups > 1) groups--;
  if (/[^aeiou]ed$/.test(w) && !/[td]ed$/.test(w) && groups > 1) groups--;
  return Math.max(1, groups);
}

// Fallback "phonology" for OOV words, built from spelling. Good enough for
// boundary-collision and texture metrics; stress defaults to initial for
// content words (the statistically dominant English pattern).
export function graphemeFallback(word, isFunction = FUNCTION_WORDS.has(word.toLowerCase())) {
  const n = estimateSyllables(word);
  const stresses = new Array(n).fill(0);
  if (!isFunction) stresses[0] = 1;
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  const onsetLetters = (w.match(/^[^aeiouy]+/) || [''])[0];
  const codaLetters = (w.match(/[^aeiouy]+$/) || [''])[0];
  return {
    oov: true,
    syllableCount: n,
    stresses,
    onsetSize: Math.min(onsetLetters.length, 3),
    codaSize: Math.min(codaLetters.length, 4),
    onsetKey: onsetLetters.slice(0, 2) || null,
    phones: [],
  };
}
