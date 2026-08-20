// Rendering layer: takes an analysis result and paints the page.

const CATEGORY_LABELS = {
  rhythm: 'Rhythm', sound: 'Sound', lexis: 'Word choice',
  syntax: 'Syntax', shape: 'Shape',
};
const POS_NAMES = {
  N: 'noun', V: 'verb', J: 'adjective', R: 'adverb', D: 'determiner',
  P: 'preposition', C: 'conjunction', M: 'modal', O: 'pronoun',
  U: 'interjection', E: 'other',
};
const SEV_LABELS = { major: 'major', moderate: 'moderate', minor: 'minor', info: 'note' };
const SEV_ORDER = { major: 3, moderate: 2, minor: 1, info: 0 };

export function describeScore(s) {
  if (s == null) return '';
  if (s >= 90) return 'flowing — reads aloud without a stumble';
  if (s >= 75) return 'smooth — minor friction only';
  if (s >= 60) return 'serviceable — a few rough seams';
  if (s >= 45) return 'choppy — the reader feels the bumps';
  return 'grinding — rhythm and sound are fighting the meaning';
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderResults(result, els) {
  const { scores } = result;
  els.overallScore.textContent = scores.overall ?? '–';
  els.overallDesc.textContent = describeScore(scores.overall);

  els.meters.innerHTML = Object.keys(CATEGORY_LABELS).map((cat) => {
    const v = scores[cat];
    if (v == null) return '';
    return `<div class="meter">
      <span class="meter-label">${CATEGORY_LABELS[cat]}</span>
      <span class="meter-track"><span class="meter-fill" style="width:${v}%"></span></span>
      <span class="meter-value">${v}</span>
    </div>`;
  }).join('');

  renderRhythm(result, els.rhythmStrip);
  renderAnnotated(result, els.annotated);
  renderFindings(result, els);
  renderTables(result, els);
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

export const LENS_LEGENDS = {
  problems: 'Underlines mark findings — solid red = major, solid orange = moderate, dotted yellow = minor, dotted gray = note. Click any word for its phonetics.',
  stress: 'Bold = carries stress, gray = unstressed. Hover a word to see its phonemes with stress digits (1 = primary).',
  sound: 'Highlights mark words that share sounds (alliteration or assonance). Each color is one sound family; dotted underline = further groups.',
  origin: 'Orange = Latinate/Romance borrowing, blue = core Germanic. Heavy orange usually means abstract, official-sounding prose.',
};

// ---------------------------------------------------------------------------

function renderFindings(result, els) {
  const list = els.findings;
  list.innerHTML = '';
  els.findingCount.textContent = result.findings.length ? `(${result.findings.length})` : '';
  if (!result.findings.length) {
    list.innerHTML = '<li class="no-findings">No problems found — this reads clean.</li>';
    return;
  }
  const makeItem = (f) => {
    const li = document.createElement('li');
    li.className = `finding sev-${f.severity}`;
    li.innerHTML = `<div><span class="finding-title">${esc(f.title)}</span>` +
      `<span class="finding-sev">${SEV_LABELS[f.severity]}</span></div>` +
      `<div class="finding-msg">${esc(f.message)}</div>` +
      (f.suggestion ? `<div class="finding-fix">${esc(f.suggestion)}</div>` : '');
    li.addEventListener('click', () => flashSpans(f.spans, els.annotated));
    return li;
  };

  // Collapse floods of the same finding type: show 3, tuck the rest behind a
  // "show N more" row (the sentence is already sprayed with underlines anyway).
  const byId = new Map();
  for (const f of result.findings) {
    if (!byId.has(f.id)) byId.set(f.id, []);
    byId.get(f.id).push(f);
  }
  for (const f of result.findings) {
    const group = byId.get(f.id);
    const idx = group.indexOf(f);
    if (idx > 2) continue;
    list.appendChild(makeItem(f));
    if (idx === 2 && group.length > 3) {
      const rest = group.slice(3);
      const more = document.createElement('li');
      more.className = 'finding sev-info more-row';
      more.innerHTML = `<div class="finding-title">＋ ${rest.length} more “${esc(f.title)}”</div>`;
      more.addEventListener('click', () => {
        more.replaceWith(...rest.map(makeItem));
      });
      list.appendChild(more);
    }
  }
}

function flashSpans(spans, annotated) {
  annotated.querySelectorAll('.tok.flash').forEach((el) => el.classList.remove('flash'));
  highlightByOffsets(annotated, spans);
  const el = annotated.querySelector('.tok.flash');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => {
    annotated.querySelectorAll('.tok.flash').forEach((e) => e.classList.remove('flash'));
  }, 2400);
}

// Live word highlight while the system voice speaks (boundary events give
// character offsets into the same text the annotated view renders).
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

function highlightByOffsets(annotated, spans) {
  let cursor = 0;
  annotated.childNodes.forEach((node) => {
    const len = node.textContent.length;
    if (node.nodeType === 1 && node.classList.contains('tok')) {
      const s = cursor, e = cursor + len;
      for (const sp of spans) {
        if (s < sp.end && e > sp.start) { node.classList.add('flash'); break; }
      }
    }
    cursor += len;
  });
}

// ---------------------------------------------------------------------------

// Finder result chips. onInsert(word) fires when a chip is clicked.
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

export function renderCompare(before, after, el) {
  const cats = Object.keys(CATEGORY_LABELS).filter(
    (c) => before.scores[c] != null || after.scores[c] != null,
  );
  const row = (label, a, b) => {
    const d = (b ?? 0) - (a ?? 0);
    const arrow = d > 0 ? '<span class="delta up" aria-label="improved">▲</span>'
      : d < 0 ? '<span class="delta down" aria-label="worse">▼</span>'
      : '<span class="delta same">＝</span>';
    return `<tr><td>${esc(label)}</td><td class="num">${a ?? '—'}</td>
      <td class="num">${b ?? '—'}</td>
      <td class="num">${arrow} ${d > 0 ? '+' : ''}${d}</td></tr>`;
  };
  const scoreTable = `<div class="metric-table-wrap"><table>
    <thead><tr><th scope="col">Score</th><th scope="col">Original</th><th scope="col">Revision</th><th scope="col">Change</th></tr></thead>
    <tbody>
      ${row('Overall flow', before.scores.overall, after.scores.overall)}
      ${cats.map((c) => row(CATEGORY_LABELS[c], before.scores[c], after.scores[c])).join('')}
    </tbody></table></div>`;

  const countBy = (res) => {
    const m = new Map();
    for (const f of res.findings) {
      if (!m.has(f.id)) m.set(f.id, { title: f.title, n: 0 });
      m.get(f.id).n++;
    }
    return m;
  };
  const a = countBy(before), b = countBy(after);
  const ids = [...new Set([...a.keys(), ...b.keys()])];
  const fixed = [], remain = [], added = [];
  for (const id of ids) {
    const na = a.get(id)?.n ?? 0, nb = b.get(id)?.n ?? 0;
    const title = (a.get(id) ?? b.get(id)).title;
    if (nb === 0) fixed.push(`${title} (×${na})`);
    else if (na === 0) added.push(`${title} (×${nb})`);
    else remain.push(`${title}: ${na} → ${nb}`);
  }
  const chip = (cls, icon, label, items) => items.length
    ? `<div class="cmp-group ${cls}"><span class="cmp-head">${icon} ${label}</span> ${items.map(esc).join(' · ')}</div>`
    : '';
  el.innerHTML = scoreTable +
    chip('cmp-fixed', '✓', 'Fixed', fixed) +
    chip('cmp-remain', '↻', 'Still there', remain) +
    chip('cmp-added', '＋', 'New in revision', added) +
    (!fixed.length && !remain.length && !added.length
      ? '<p class="no-findings">No findings in either version.</p>' : '');
}

// ---------------------------------------------------------------------------

function renderTables(result, els) {
  const wrap = els.metricTables;
  wrap.innerHTML = '';
  result.sentences.forEach((s, i) => {
    const h = document.createElement('h3');
    const preview = s.ann.slice(0, 6).map((a) => a.token.value).join(' ');
    h.textContent = result.sentences.length > 1
      ? `Sentence ${i + 1} — “${preview}${s.ann.length > 6 ? '…' : ''}”` : 'Metrics';
    const div = document.createElement('div');
    div.className = 'metric-table-wrap';
    div.innerHTML = `<table>
      <thead><tr><th scope="col">Metric</th><th scope="col">Value</th><th scope="col">Score</th></tr></thead>
      <tbody>${s.metrics.map((m) => `<tr>
        <td>${esc(m.label)}</td>
        <td class="num">${esc(String(m.value))}</td>
        <td class="num">${m.score != null ? `<span class="score-chip">${m.score}</span>` : '—'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
    wrap.appendChild(h);
    wrap.appendChild(div);
  });

  const r = result.readability;
  els.readability.innerHTML = !r ? '' : `<div class="metric-table-wrap"><table>
    <thead><tr><th scope="col">Formula</th><th scope="col">Result</th><th scope="col">Meaning</th></tr></thead>
    <tbody>
      <tr><td>Flesch Reading Ease</td><td class="num">${r.fleschEase}</td><td>${r.fleschEase >= 80 ? 'easy' : r.fleschEase >= 60 ? 'plain' : r.fleschEase >= 30 ? 'difficult' : 'very difficult'}</td></tr>
      <tr><td>Flesch–Kincaid grade</td><td class="num">${r.fkGrade}</td><td>US school grade</td></tr>
      <tr><td>Gunning Fog</td><td class="num">${r.fog}</td><td>years of education</td></tr>
      <tr><td>SMOG</td><td class="num">${r.smog}</td><td>years of education</td></tr>
      <tr><td>Coleman–Liau</td><td class="num">${r.colemanLiau}</td><td>US school grade</td></tr>
      <tr><td>Automated Readability</td><td class="num">${r.ari}</td><td>US school grade</td></tr>
      <tr><td>LIX</td><td class="num">${r.lix}</td><td>${r.lix < 40 ? 'easy' : r.lix < 55 ? 'medium' : 'hard'}</td></tr>
    </tbody></table></div>`;
}
