// Tokenizer + sentence splitter. Tokens keep character offsets so the UI can
// highlight the exact source text behind any finding.
import { ABBREVIATIONS } from './wordlists.js?v=32';

const TOKEN_RE = /[A-Za-zÀ-ɏ]+(?:['’-][A-Za-zÀ-ɏ]+)*|\d+(?:[.,]\d+)*|[.!?…]+|[,;:]|[—–]|-{2,}|["“”'‘’()\[\]]|\S/g;

export function tokenize(text) {
  const tokens = [];
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const value = m[0];
    const kind = /^[A-Za-zÀ-ɏ]/.test(value) ? 'word'
      : /^\d/.test(value) ? 'number'
      : /^[.!?…]/.test(value) ? 'terminal'
      : /^[,;:—–]|^-{2,}$/.test(value) ? 'pause'
      : 'punct';
    tokens.push({ value, kind, start: m.index, end: m.index + value.length });
  }
  return tokens;
}

// Group tokens into sentences. A terminal ends a sentence unless it follows a
// known abbreviation or a single capital initial ("J.").
export function splitSentences(tokens) {
  const sentences = [];
  let current = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    current.push(t);
    if (t.kind !== 'terminal') continue;
    const prev = tokens[i - 1];
    if (t.value === '.' && prev && prev.kind === 'word') {
      const w = prev.value.toLowerCase().replace(/\./g, '');
      if (ABBREVIATIONS.has(w) || /^[a-z]$/.test(w)) continue;
    }
    // Pull trailing close-quotes/parens into this sentence.
    while (i + 1 < tokens.length && /^["”’)\]]$/.test(tokens[i + 1].value)) {
      current.push(tokens[++i]);
    }
    sentences.push(current);
    current = [];
  }
  if (current.some((t) => t.kind === 'word' || t.kind === 'number')) {
    sentences.push(current);
  }
  return sentences.filter((s) => s.some((t) => t.kind === 'word' || t.kind === 'number'));
}
