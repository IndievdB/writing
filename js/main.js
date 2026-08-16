// App wiring: data loading, input handling, lens tabs, theme toggle.
import { Lexicon } from './lexicon.js';
import { analyzeText } from './analyze.js';
import { renderResults, renderInspector, renderCompare, LENS_LEGENDS } from './ui.js';

const $ = (id) => document.getElementById(id);
const els = {
  input: $('text-input'), status: $('status'), results: $('results'),
  overallScore: $('overall-score'), overallDesc: $('overall-desc'),
  meters: $('category-meters'), rhythmStrip: $('rhythm-strip'),
  annotated: $('annotated'), lensLegend: $('lens-legend'),
  inspector: $('word-inspector'), findings: $('findings'),
  findingCount: $('finding-count'), metricTables: $('metric-tables'),
  readability: $('readability'),
  revisionWrap: $('revision-wrap'), revisionInput: $('revision-input'),
  revisionToggle: $('revision-toggle'),
  comparePanel: $('compare-panel'), compareBody: $('compare-body'),
};

const EXAMPLES = {
  choppy: 'The big dog barked. The mad cat hissed. The old man yelled. The day went bad. The night got worse.',
  sludge: 'The implementation of the organizational transformation necessitates the utilization of additional resources to facilitate the optimization of operational effectiveness.',
  twister: 'The crisp splash struck; strengths stripped, sixths slipped past stressed guests.',
  smooth: 'When I was a boy, the river ran clear past our house, and we swam in it every warm evening until the light failed.',
};

const lexicon = new Lexicon();
let lastResult = null;

async function loadData() {
  const files = ['cmudict', 'pos', 'conc', 'freq'];
  let done = 0;
  const update = () => { els.status.textContent = `loading dictionaries… ${done}/${files.length}`; };
  update();
  try {
    const texts = await Promise.all(files.map(async (f) => {
      const res = await fetch(`data/${f}.txt`);
      if (!res.ok) throw new Error(`${f}.txt: HTTP ${res.status}`);
      const t = await res.text();
      done++; update();
      return t;
    }));
    lexicon.load({ cmudict: texts[0], pos: texts[1], conc: texts[2], freq: texts[3] });
    els.status.textContent = `ready — ${lexicon.phones.size.toLocaleString()} words in the pronouncing dictionary`;
    run();
  } catch (e) {
    els.status.textContent = `could not load dictionaries (${e.message}). If you opened index.html directly, serve the folder instead: python3 -m http.server`;
  }
}

function run() {
  if (!lexicon.ready) return;
  const text = els.input.value;
  if (!text.trim()) { els.results.hidden = true; els.comparePanel.hidden = true; return; }
  lastResult = analyzeText(text, lexicon);

  // Compare mode: when a revision exists, findings/annotations show the
  // revision (the thing being worked on); the compare panel shows the deltas.
  const revText = els.revisionWrap.hidden ? '' : els.revisionInput.value;
  if (revText.trim()) {
    const revised = analyzeText(revText, lexicon);
    renderCompare(lastResult, revised, els.compareBody);
    els.comparePanel.hidden = false;
    lastResult = revised;
  } else {
    els.comparePanel.hidden = true;
  }

  renderResults(lastResult, els);
  els.results.hidden = false;
  els.inspector.hidden = true;
  saveHash();
}

// Shareable URLs: keep the text (and revision) in the location hash.
function saveHash() {
  const t = els.input.value;
  const r = els.revisionWrap.hidden ? '' : els.revisionInput.value;
  const hash = t.trim()
    ? '#t=' + encodeURIComponent(t) + (r.trim() ? '&r=' + encodeURIComponent(r) : '')
    : '';
  history.replaceState(null, '', hash || location.pathname);
}

function restoreHash() {
  const m = location.hash.match(/^#t=([^&]*)(?:&r=(.*))?$/);
  if (!m) return;
  els.input.value = decodeURIComponent(m[1]);
  if (m[2]) {
    els.revisionInput.value = decodeURIComponent(m[2]);
    els.revisionWrap.hidden = false;
    els.revisionToggle.textContent = 'hide revision';
  }
}

let timer = null;
const queueRun = () => { clearTimeout(timer); timer = setTimeout(run, 350); };
els.input.addEventListener('input', queueRun);
els.revisionInput.addEventListener('input', queueRun);

els.revisionToggle.addEventListener('click', () => {
  const show = els.revisionWrap.hidden;
  els.revisionWrap.hidden = !show;
  els.revisionToggle.textContent = show ? 'hide revision' : 'compare a revision';
  if (show && !els.revisionInput.value.trim()) {
    els.revisionInput.value = els.input.value;
    els.revisionInput.focus();
  }
  run();
});

document.querySelectorAll('[data-example]').forEach((btn) => {
  btn.addEventListener('click', () => {
    els.input.value = EXAMPLES[btn.dataset.example];
    run();
  });
});

// Lens tabs.
const annotatedPanel = els.annotated;
function setLens(lens) {
  annotatedPanel.className = `annotated lens-${lens}`;
  els.lensLegend.textContent = LENS_LEGENDS[lens];
  document.querySelectorAll('.lens-tabs [role="tab"]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.lens === lens));
  });
}
document.querySelectorAll('.lens-tabs [role="tab"]').forEach((b) => {
  b.addEventListener('click', () => setLens(b.dataset.lens));
});
setLens('problems');

// Word inspector.
els.annotated.addEventListener('click', (e) => {
  const tok = e.target.closest('.tok.word');
  if (!tok || !lastResult) return;
  const s = lastResult.sentences[Number(tok.dataset.si)];
  const a = s?.ann[Number(tok.dataset.wi)];
  if (a) renderInspector(a, els.inspector);
});

// Theme toggle: auto -> explicit dark -> explicit light.
const root = document.documentElement;
const savedTheme = localStorage.getItem('cadence-theme');
if (savedTheme) root.dataset.theme = savedTheme;
$('theme-toggle').addEventListener('click', () => {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const current = root.dataset.theme || (prefersDark ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  localStorage.setItem('cadence-theme', next);
});

restoreHash();
loadData();
