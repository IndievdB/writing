// Rendering layer: takes an analysis result and paints the page.
import { BRIGHT_VOWELS, DARK_VOWELS } from './phonology.js?v=33';
import { VOWELS } from './lexicon.js?v=33';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderResults(result, els, rhythmOpts) {
  renderRhythm(result, els.rhythmStrip, rhythmOpts);
}

// ---------------------------------------------------------------------------

const OVERRIDE_NAMES = { 1: 'stressed (override)', 0: 'unstressed (override)', skip: 'skipped — not tapped' };
const SVG_NS = 'http://www.w3.org/2000/svg';
const ARC_COLORS = ['#d97706', '#0ea5e9', '#a855f7', '#10b981', '#ef4444', '#8b5cf6'];

// Nucleus brightness: front vowels bright (gold), back vowels dark (blue).
function vowelColor(nucleus) {
  if (!nucleus) return 'transparent';
  if (BRIGHT_VOWELS.has(nucleus)) return 'hsl(45 85% 52%)';
  if (DARK_VOWELS.has(nucleus)) return 'hsl(230 62% 58%)';
  return 'hsl(0 0% 58%)';
}

// Dominant metrical foot of a binary stress sequence, with the break point.
function meterVerdict(bits, words) {
  if (bits.length < 6) return null;
  const feet = [
    ['iambic (da-DUM)', '01'], ['trochaic (DUM-da)', '10'],
    ['anapestic (da-da-DUM)', '001'], ['dactylic (DUM-da-da)', '100'],
  ];
  let best = null;
  for (const [name, pat] of feet) {
    let match = 0;
    for (let i = 0; i < bits.length; i++) if (String(bits[i]) === pat[i % pat.length]) match++;
    const frac = match / bits.length;
    if (!best || frac > best.frac) best = { name, pat, frac };
  }
  if (best.frac >= 0.99) return `perfectly ${best.name}`;
  if (best.frac >= 0.72) {
    let breakWord = null;
    for (let i = 0; i < bits.length; i++) {
      if (String(bits[i]) !== best.pat[i % best.pat.length]) { breakWord = words[i]; break; }
    }
    return `mostly ${best.name}${breakWord ? ` — breaks at “${breakWord}”` : ''}`;
  }
  return 'no regular meter — free rhythm';
}

function cadenceVerdict(effs, sylls, ann) {
  if (!sylls.length) return null;
  const lastWord = ann[sylls[sylls.length - 1].wordIndex];
  let note = '';
  if (lastWord && lastWord.ety?.origin === 'latinate' && lastWord.phon.syllableCount >= 3) {
    note = ' — a diffuse Latinate ending';
  }
  if (effs[effs.length - 1] >= 1) return `hard close: lands on a stressed syllable${note}`;
  let n = 0;
  for (let i = effs.length - 1; i >= 0 && effs[i] === 0; i--) n++;
  return `soft close: trails off ${n} unstressed syllable${n === 1 ? '' : 's'}${note}`;
}

// Predicted pitch (0..1) per syllable: declination + accents + boundary tones.
function pitchContour(sylls, effs, ann, terminal) {
  const n = sylls.length;
  let nuclearIdx = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (effs[i] >= 1 && !ann[sylls[i].wordIndex].isFunction) { nuclearIdx = i; break; }
  }
  return sylls.map((syl, i) => {
    let v = 0.72 - 0.42 * (n > 1 ? i / (n - 1) : 0);
    if (effs[i] >= 1 && !ann[syl.wordIndex].isFunction) v += 0.32;
    if (i === nuclearIdx) v += 0.1;
    if (syl.pauseAfter && i < n - 1) v += 0.18; // continuation rise
    if (i === n - 1) v = terminal === '?' ? 0.95 : terminal === '!' ? Math.max(v, 0.6) : 0.05;
    return Math.max(0.02, Math.min(1, v));
  });
}

// Repeated opening consonants (alliteration) and stressed vowels (assonance)
// among content words.
function echoGroups(ann) {
  const byOnset = new Map(), byVowel = new Map();
  ann.forEach((a, wi) => {
    if (a.isFunction || a.isNumber) return;
    const p0 = a.phon.phones?.[0];
    if (p0 && !VOWELS.has(p0)) {
      if (!byOnset.has(p0)) byOnset.set(p0, []);
      byOnset.get(p0).push(wi);
    }
    const sv = a.phon.stressedVowel;
    if (sv) {
      if (!byVowel.has(sv)) byVowel.set(sv, []);
      byVowel.get(sv).push(wi);
    }
  });
  const groups = [];
  for (const [k, wis] of byOnset) if (wis.length >= 2) groups.push({ kind: 'alliteration', key: k, wis });
  for (const [k, wis] of byVowel) if (wis.length >= 2) groups.push({ kind: 'assonance', key: k, wis });
  groups.sort((a, b) => b.wis.length - a.wis.length);
  return groups.slice(0, 6);
}

function renderRhythm(result, container, { overrides = null, onToggle = null, lenses = {} } = {}) {
  container.innerHTML = '';
  result.sentences.forEach((s, si) => {
    const idxOf = new Map(s.sylls.map((x, i) => [x, i]));
    const clashSet = new Set();
    for (const [wa, wb] of s.marks.clashes) {
      clashSet.add(`${wa}:last`);
      clashSet.add(`${wb}:first`);
    }
    const terminal = [...s.tokens].reverse().find((t) => t.kind === 'terminal')?.value?.slice(-1) ?? '.';

    // Effective stresses (with overrides) and skip flags, in syllable order.
    const eff = s.sylls.map((syl, i) => {
      const ov = overrides?.get(`${si}:${i}`);
      return ov === 'skip' ? null : ov === '1' ? 1 : ov === '0' ? 0 : syl.stress;
    });
    // Patter: runs of 4+ unstressed syllables between beats.
    const patter = new Set();
    let run = [];
    eff.forEach((e, i) => {
      if (e === 0) run.push(i);
      else { if (run.length >= 4) run.forEach((x) => patter.add(x)); run = []; }
    });
    if (run.length >= 4) run.forEach((x) => patter.add(x));

    const line = document.createElement('div');
    line.className = 'rhythm-line';
    if (lenses.pitch) line.classList.add('with-pitch');

    const blockEls = new Array(s.sylls.length).fill(null);
    const labelEls = new Map(); // wordIndex -> label element

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
        const gi = idxOf.get(syl);
        const key = `${si}:${gi}`;
        const ov = overrides?.get(key);
        const e = ov === '1' ? 1 : ov === '0' ? 0 : syl.stress;
        b.className = `syll s${e}`;
        if (ov === 'skip') b.classList.add('skip');
        else if (ov !== undefined) b.classList.add('ovr');
        if (patter.has(gi)) b.classList.add('patter');
        if (lenses.dur) b.style.width = `${5 + Math.round((syl.dur ?? 1) * 6)}px`;
        if (lenses.vowels) b.style.borderBottom = `4px solid ${vowelColor(syl.nucleus)}`;
        const pos = k === 0 ? 'first' : k === sylls.length - 1 ? 'last' : '';
        if (pos && clashSet.has(`${wi}:${pos}`)) b.classList.add('clash');
        if (sylls.length === 1 && (clashSet.has(`${wi}:first`) || clashSet.has(`${wi}:last`))) {
          b.classList.add('clash');
        }
        const state = ov !== undefined ? OVERRIDE_NAMES[ov]
          : syl.stress === 1 ? 'primary stress' : syl.stress === 2 ? 'secondary stress' : 'unstressed';
        b.title = `${a.token.value} — ${state}` +
          (patter.has(gi) ? '\npart of a long unstressed run (patter)' : '') +
          (onToggle ? '\nclick to override: stressed → unstressed → skip → auto' : '');
        if (onToggle) b.addEventListener('click', () => onToggle(key));
        blocks.appendChild(b);
        blockEls[gi] = b;
      });
      const label = document.createElement('div');
      label.className = 'rhythm-word-label';
      label.textContent = a.token.value;
      labelEls.set(wi, label);
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

    const inner = document.createElement('div');
    inner.className = 'rhythm-inner';
    const groups = lenses.arcs ? echoGroups(s.ann) : [];
    if (groups.length) inner.classList.add('with-arcs');
    inner.appendChild(line);

    const wrap = document.createElement('div');
    wrap.className = 'rhythm-sentence';
    wrap.appendChild(inner);

    // Verdicts: meter + cadence (always on).
    const kept = eff.map((e, i) => [e, i]).filter(([e]) => e !== null);
    const bits = kept.map(([e]) => (e >= 1 ? 1 : 0));
    const bitWords = kept.map(([, i]) => s.ann[s.sylls[i].wordIndex].token.value);
    const meter = meterVerdict(bits, bitWords);
    const cadence = cadenceVerdict(bits, kept.map(([, i]) => s.sylls[i]), s.ann);
    if (meter || cadence) {
      const v = document.createElement('div');
      v.className = 'prosody-verdict';
      v.textContent = [meter, cadence].filter(Boolean).join('  ·  ');
      wrap.appendChild(v);
    }
    container.appendChild(wrap);

    // Overlay (pitch line + echo arcs) drawn after layout so positions are real.
    if (lenses.pitch || groups.length) {
      requestAnimationFrame(() => {
        const rect = inner.getBoundingClientRect();
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'prosody-overlay');
        svg.setAttribute('width', inner.scrollWidth);
        svg.setAttribute('height', inner.offsetHeight);
        if (lenses.pitch) {
          const vals = pitchContour(s.sylls, eff.map((e) => e ?? 0), s.ann, terminal);
          const pts = [];
          blockEls.forEach((b, i) => {
            if (!b) return;
            const r = b.getBoundingClientRect();
            pts.push(`${(r.left + r.right) / 2 - rect.left},${4 + (1 - vals[i]) * 22}`);
          });
          if (pts.length > 1) {
            const pl = document.createElementNS(SVG_NS, 'polyline');
            pl.setAttribute('points', pts.join(' '));
            pl.setAttribute('class', 'pitch-line');
            const t = document.createElementNS(SVG_NS, 'title');
            t.textContent = 'predicted pitch — a neutral reading';
            pl.appendChild(t);
            svg.appendChild(pl);
          }
        }
        groups.forEach((g, gi) => {
          const color = ARC_COLORS[gi % ARC_COLORS.length];
          for (let k = 0; k + 1 < g.wis.length; k++) {
            const la = labelEls.get(g.wis[k]), lb = labelEls.get(g.wis[k + 1]);
            if (!la || !lb) continue;
            const ra = la.getBoundingClientRect(), rb = lb.getBoundingClientRect();
            const x1 = (ra.left + ra.right) / 2 - rect.left;
            const x2 = (rb.left + rb.right) / 2 - rect.left;
            const y = Math.max(ra.bottom, rb.bottom) - rect.top + 2;
            const dip = Math.min(14, 5 + (x2 - x1) / 14);
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('d', `M ${x1} ${y} Q ${(x1 + x2) / 2} ${y + dip} ${x2} ${y}`);
            path.setAttribute('class', `echo-arc ${g.kind === 'assonance' ? 'echo-vowel' : ''}`);
            path.setAttribute('stroke', color);
            const t = document.createElementNS(SVG_NS, 'title');
            t.textContent = `${g.kind}: ${g.wis.map((wi) => s.ann[wi].token.value).join(', ')}`;
            path.appendChild(t);
            svg.appendChild(path);
          }
        });
        if (svg.childNodes.length) inner.appendChild(svg);
      });
    }
  });
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
      + ' — click a word for its definition.';
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
      if (r.info.ety.origin !== 'neutral') {
        bits.push(r.info.ety.origin === 'germanic' ? 'anglo-saxon' : r.info.ety.origin);
      }
      if (r.info.conc != null) bits.push(`concreteness ${(r.info.conc / 100).toFixed(1)}/5`);
      chip.title = bits.filter(Boolean).join('\n');
      chip.addEventListener('click', () => onInsert(r.word, chip));
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
