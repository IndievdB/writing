// Rendering layer: takes an analysis result and paints the page.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderResults(result, els) {
  renderRhythm(result, els.rhythmStrip);
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

const FINDER_PAGE = 48;

export function renderFinderResults(results, el, statusEl, onInsert, query) {
  el.innerHTML = '';
  if (!results.length) {
    statusEl.textContent = query.empty
      ? 'Type a meaning above, set a sound constraint, or both — results appear here.'
      : 'No words match — loosen a constraint (stress pattern and rhyme are the strictest).';
    return;
  }
  const show = (count) => {
    el.innerHTML = '';
    const visible = results.slice(0, count);
    statusEl.textContent = (visible.length < results.length
      ? `showing ${visible.length} of ${results.length} words`
      : `${results.length} word${results.length === 1 ? '' : 's'}`)
      + ' — click one to insert it into your sentence at the cursor. Hover for details.';
    const frag = document.createDocumentFragment();
    for (const r of visible) {
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
    if (visible.length < results.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'show-more';
      more.textContent = `show ${Math.min(FINDER_PAGE, results.length - visible.length)} more`;
      more.addEventListener('click', () => show(count + FINDER_PAGE));
      frag.appendChild(more);
    }
    el.appendChild(frag);
  };
  show(FINDER_PAGE);
}
