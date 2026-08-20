// Rendering layer: takes an analysis result and paints the page.

const POS_NAMES = {
  N: 'noun', V: 'verb', J: 'adjective', R: 'adverb', D: 'determiner',
  P: 'preposition', C: 'conjunction', M: 'modal', O: 'pronoun',
  U: 'interjection', E: 'other',
};
const SEV_ORDER = { major: 3, moderate: 2, minor: 1, info: 0 };

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderResults(result, els) {
  renderRhythm(result, els.rhythmStrip);
  renderAnnotated(result, els.annotated);
}

// ---------------------------------------------------------------------------

function renderRhythm(result, container) {
  container.innerHTML = '';
  for (const s of result.sentences) {
    const clashSet = new Set();
    for (const [wa, wb] of s.marks.clashes) {
      clashSet.add(`${wa}:last`);
      clashSet.add(`${wb}:first`);
    }
    const line = document.createElement('div');
    line.className = 'rhythm-line';

    // Group syllables by word.
    const byWord = new Map();
    for (const syl of s.sylls) {
      if (!byWord.has(syl.wordIndex)) byWord.set(syl.wordIndex, []);
      byWord.get(syl.wordIndex).push(syl);
    }
    for (const [wi, sylls] of byWord) {
      const a = s.ann[wi];
      const group = document.createElement('div');
      group.className = 'wordgroup';
      const blocks = document.createElement('div');
      blocks.className = 'blocks';
      sylls.forEach((syl, k) => {
        const b = document.createElement('span');
        b.className = `syll s${syl.stress}`;
        const pos = k === 0 ? 'first' : k === sylls.length - 1 ? 'last' : '';
        if (pos && clashSet.has(`${wi}:${pos}`)) {
          // Also handle single-syllable words being both first and last.
          b.classList.add('clash');
        }
        if (sylls.length === 1 && (clashSet.has(`${wi}:first`) || clashSet.has(`${wi}:last`))) {
          b.classList.add('clash');
        }
        b.title = `${a.token.value} — ${syl.stress === 1 ? 'primary stress' : syl.stress === 2 ? 'secondary stress' : 'unstressed'}`;
        blocks.appendChild(b);
      });
      const label = document.createElement('div');
      label.className = 'rhythm-word-label';
      label.textContent = a.token.value;
      group.appendChild(blocks);
      group.appendChild(label);
      line.appendChild(group);
      if (sylls[sylls.length - 1].pauseAfter) {
        const gap = document.createElement('span');
        gap.className = 'pause-gap';
        gap.title = 'pause';
        line.appendChild(gap);
      }
    }
    const wrap = document.createElement('div');
    wrap.className = 'rhythm-sentence';
    wrap.appendChild(line);
    container.appendChild(wrap);
  }
}

// ---------------------------------------------------------------------------

function stressClass(a) {
  const st = a.phon.stresses;
  if (st.every((x) => x === 0)) return 'stress-0';
  if (st.length === 1) return 'stress-1';
  return 'stress-mixed';
}

function renderAnnotated(result, container) {
  container.innerHTML = '';
  const { text } = result;
  let cursor = 0;
  const frag = document.createDocumentFragment();

  // Sound groups: assign the first three distinct sound keys to categorical
  // slots; the rest fall back to a non-color marker (dotted underline).
  const soundGroups = new Map(); // "kind:key" -> slot index
  const wordSound = new Map();   // "si:wi" -> slot
  result.sentences.forEach((s, si) => {
    for (const m of s.marks.sound) {
      const gk = `${m.kind}:${m.key}`;
      if (!soundGroups.has(gk)) soundGroups.set(gk, soundGroups.size);
      for (const wi of m.words) {
        const key = `${si}:${wi}`;
        if (!wordSound.has(key)) wordSound.set(key, soundGroups.get(gk));
      }
    }
  });

  // Finding severity per character-range, applied to word tokens.
  const sevFor = (tok) => {
    let best = null;
    for (const f of result.findings) {
      for (const sp of f.spans) {
        if (tok.start < sp.end && tok.end > sp.start) {
          if (!best || SEV_ORDER[f.severity] > SEV_ORDER[best]) best = f.severity;
        }
      }
    }
    return best;
  };

  result.sentences.forEach((s, si) => {
    s.tokens.forEach((tok) => {
      if (tok.start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, tok.start)));
      cursor = tok.end;
      const span = document.createElement('span');
      span.className = `tok ${tok.kind}`;
      span.textContent = tok.value;
      const wi = s.ann.findIndex((a) => a.token === tok);
      if (wi >= 0) {
        const a = s.ann[wi];
        span.dataset.si = si;
        span.dataset.wi = wi;
        span.classList.add(stressClass(a));
        if (a.ety.origin === 'latinate') span.classList.add('ety-latinate');
        else if (a.ety.origin === 'germanic' && !a.isFunction) span.classList.add('ety-germanic');
        const slot = wordSound.get(`${si}:${wi}`);
        if (slot != null) span.classList.add(slot < 3 ? `snd-${slot}` : 'snd-more');
        const sev = sevFor(tok);
        if (sev) span.classList.add(`f-${sev}`);
        span.title = a.phon.rawPhones ? a.phon.rawPhones.join(' ') : '';
      }
      frag.appendChild(span);
    });
  });
  if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
  container.appendChild(frag);
}

export function markSpeakingWord(annotated, start, end) {
  annotated.querySelectorAll('.tok.speaking').forEach((el) => el.classList.remove('speaking'));
  if (start == null) return;
  let cursor = 0;
  for (const node of annotated.childNodes) {
    const len = node.textContent.length;
    if (node.nodeType === 1 && node.classList.contains('tok')) {
      const s = cursor, e = cursor + len;
      if (s < end && e > start) { node.classList.add('speaking'); return; }
    }
    cursor += len;
  }
}

export function renderFinderResults(results, el, statusEl, onInsert, query) {
  el.innerHTML = '';
  if (!results.length) {
    statusEl.textContent = query.empty
      ? 'Type a meaning above, set a sound constraint, or both — results appear here.'
      : 'No words match — loosen a constraint (stress pattern and rhyme are the strictest).';
    return;
  }
  statusEl.textContent = `${results.length} word${results.length === 1 ? '' : 's'} — click one to insert it into your sentence at the cursor. Hover for details.`;
  const frag = document.createDocumentFragment();
  for (const r of results) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'word-chip';
    chip.dataset.word = r.word;
    const stress = (r.info.phon.dictStresses ?? r.info.phon.stresses)
      .map((s) => (s >= 1 ? '´' : '˘')).join('');
    chip.innerHTML = `<span class="chip-word">${esc(r.word)}</span><span class="chip-meta">${stress}</span>`;
    const bits = [r.info.phon.rawPhones?.join(' ')];
    if (r.reasons.length) bits.push(r.reasons.join('; '));
    if (r.info.ety.origin !== 'neutral') bits.push(r.info.ety.origin);
    if (r.info.conc != null) bits.push(`concreteness ${(r.info.conc / 100).toFixed(1)}/5`);
    chip.title = bits.filter(Boolean).join('\n');
    chip.addEventListener('click', () => onInsert(r.word));
    frag.appendChild(chip);
  }
  el.appendChild(frag);
}

export function renderInspector(a, el) {
  const ord = (n) => `#${n.toLocaleString()}`;
  const items = [];
  if (a.phon.rawPhones?.length) items.push(['sounds', a.phon.rawPhones.join(' ')]);
  items.push(['syllables', String(a.phon.syllableCount)]);
  items.push(['stress', a.phon.stresses.map((s) => (s ? '´' : '˘')).join(' ')]);
  items.push(['role', POS_NAMES[a.pos] || a.pos]);
  if (a.freqRank) items.push(['frequency', `${ord(a.freqRank)} most common`]);
  else if (!a.isNumber) items.push(['frequency', 'rare (not in top 100k)']);
  if (a.conc != null) {
    const c = a.conc / 100;
    items.push(['concreteness', `${c.toFixed(1)}/5 ${c >= 4 ? '(you can picture it)' : c <= 2.5 ? '(abstract)' : ''}`]);
  }
  if (a.ety.origin !== 'neutral') items.push(['origin', `${a.ety.origin} (heuristic)`]);
  if (a.ety.swap) items.push(['plainer', `“${a.ety.swap}”`]);
  if (a.phon.oov) items.push(['note', 'not in the pronouncing dictionary — estimated']);
  el.innerHTML = `<div class="wi-head">${esc(a.token.value)}` +
    `<button type="button" class="wi-speak" data-word="${esc(a.token.value)}" title="Say this word">🔊</button>` +
    `<button type="button" class="wi-find" data-find-word="${esc(a.lower)}">find alternatives ↓</button></div>` +
    items.map(([k, v]) => `<span class="wi-item">${k}: <b>${esc(v)}</b></span>`).join('');
  el.hidden = false;
}

// ---------------------------------------------------------------------------
// Compare mode: original vs revision — category deltas + which finding types
// were fixed, remain, or are new.
