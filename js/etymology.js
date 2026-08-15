// Latinate vs. Germanic heuristic classifier.
// No complete free etymology dataset exists, but surface morphology plus
// frequency plus curated exception lists gets high accuracy on exactly the
// words that matter (the long Latinate ones).
import {
  FUNCTION_WORDS, GERMANIC_COMMON, LATINATE_COMMON, LATINATE_SUFFIXES,
  LATINATE_PREFIXES, GERMANIC_SUFFIXES, LATINATE_SWAPS,
} from './wordlists.js';

// Returns { origin: 'latinate'|'germanic'|'neutral', confidence: 0..1, swap }
export function classifyOrigin(word, { syllableCount = null, freqRank = null } = {}) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return { origin: 'neutral', confidence: 0, swap: null };
  const swap = LATINATE_SWAPS.get(w) || null;

  if (FUNCTION_WORDS.has(w)) return { origin: 'germanic', confidence: 0.9, swap: null };
  if (GERMANIC_COMMON.has(w)) return { origin: 'germanic', confidence: 0.95, swap: null };
  if (LATINATE_COMMON.has(w) || swap) return { origin: 'latinate', confidence: 0.9, swap };

  let score = 0; // positive = Latinate, negative = Germanic

  for (const suf of LATINATE_SUFFIXES) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) {
      score += suf.length >= 4 ? 3 : suf.length === 3 ? 2 : 1;
      break;
    }
  }
  for (const suf of GERMANIC_SUFFIXES) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) { score -= 2; break; }
  }
  for (const pre of LATINATE_PREFIXES) {
    if (w.length > pre.length + 3 && w.startsWith(pre)) { score += 1; break; }
  }

  // Spelling patterns nearly exclusive to Romance borrowings.
  if (/(ct|pt|x|qu)/.test(w) && w.length > 5) score += 1;
  if (/(gh|th|wh|kn|wr|sw|tw)/.test(w)) score -= 2;
  if (/ee|oo|ea/.test(w)) score -= 1;

  // Length: native core vocabulary is short; 3+ syllable words are
  // overwhelmingly borrowed.
  if (syllableCount != null) {
    if (syllableCount >= 4) score += 3;
    else if (syllableCount === 3) score += 2;
    else if (syllableCount === 1) score -= 1;
  }

  // Very high frequency correlates with native origin.
  if (freqRank != null && freqRank <= 1000 && (syllableCount ?? 2) <= 2) score -= 1;

  if (score >= 2) return { origin: 'latinate', confidence: Math.min(1, 0.5 + score * 0.12), swap };
  if (score <= -2) return { origin: 'germanic', confidence: Math.min(1, 0.5 + -score * 0.12), swap: null };
  return { origin: 'neutral', confidence: 0.3, swap };
}
