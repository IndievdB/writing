// App wiring: data loading, input handling, theme toggle.
import { Lexicon } from './lexicon.js';
import { analyzeText } from './analyze.js';
import { Finder } from './finder.js';
import { renderResults, renderInspector, renderFinderResults, markSpeakingWord } from './ui.js';
import { systemAvailable, listSystemVoices, speakSystem, stopSystem, NeuralTTS, NEURAL_VOICES } from './speech.js';

const $ = (id) => document.getElementById(id);
const els = {
  input: $('text-input'), status: $('status'), results: $('results'),
  rhythmStrip: $('rhythm-strip'),
  annotated: $('annotated'),
  inspector: $('word-inspector'),
  seedInput: $('seed-input'), finderStatus: $('finder-status'),
  finderResults: $('finder-results'), finderClear: $('finder-clear'),
};
const constraintEls = {
  allit: $('c-allit'), asson: $('c-asson'), conson: $('c-conson'),
  rhyme: $('c-rhyme'), syll: $('c-syll'), stress: $('c-stress'),
  texture: $('c-texture'), origin: $('c-origin'), feel: $('c-feel'),
  rarity: $('c-rarity'),
};

const lexicon = new Lexicon();
const finder = new Finder(lexicon);
let lastResult = null;

async function loadData() {
  const files = ['cmudict', 'pos', 'conc', 'freq', 'thesaurus'];
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
    finder.loadThesaurus(texts[4]);
    // Curated synonym layer (Claude-generated at build time) — optional file.
    try {
      const res = await fetch('data/synonyms.txt');
      if (res.ok) finder.loadSynonyms(await res.text());
    } catch { /* absent locally is fine; WordNet still works */ }
    els.status.textContent = `ready — ${lexicon.phones.size.toLocaleString()} words, ${finder.curated.size.toLocaleString()} curated entries, ${finder.synsets.length.toLocaleString()} synonym groups`;
    run();
    runFinder();
  } catch (e) {
    els.status.textContent = `could not load dictionaries (${e.message}). If you opened index.html directly, serve the folder instead: python3 -m http.server`;
  }
}

function run() {
  if (!lexicon.ready) return;
  const text = els.input.value;
  if (!text.trim()) { els.results.hidden = true; return; }
  lastResult = analyzeText(text, lexicon);
  renderResults(lastResult, els);
  els.results.hidden = false;
  els.inspector.hidden = true;
  saveHash();
}

// Shareable URLs: keep the sentence in the location hash.
function saveHash() {
  const t = els.input.value;
  const hash = t.trim() ? '#t=' + encodeURIComponent(t) : '';
  history.replaceState(null, '', hash || location.pathname);
}

function restoreHash() {
  const m = location.hash.match(/^#t=([^&]*)/);
  if (m) els.input.value = decodeURIComponent(m[1]);
}

// ---- word finder ----

function runFinder() {
  if (!lexicon.ready) return;
  // Single-word searches: one seed word only.
  const seeds = els.seedInput.value.toLowerCase()
    .split(/[\s,;]+/).map((s) => s.replace(/[^a-z'\-]/g, '')).filter(Boolean)
    .slice(0, 1);
  const constraints = {};
  for (const [k, el] of Object.entries(constraintEls)) constraints[k] = el.value;
  const empty = !seeds.length && Object.values(constraints).every((v) => !v || !v.trim());
  const results = empty ? [] : finder.search({ seeds, constraints });
  renderFinderResults(results, els.finderResults, els.finderStatus, insertWord, { empty });
}

// Insert a found word into the sentence at the cursor, with sane spacing.
function insertWord(word) {
  const ta = els.input;
  const pos = ta.selectionStart ?? ta.value.length;
  const before = ta.value.slice(0, pos);
  const after = ta.value.slice(ta.selectionEnd ?? pos);
  const lead = before && !/[\s(\["'“‘\-—]$/.test(before) ? ' ' : '';
  const trail = after && !/^[\s.,;:!?)\]"'”’\-—]/.test(after) ? ' ' : '';
  ta.value = before + lead + word + trail + after;
  const cursor = (before + lead + word).length;
  ta.setSelectionRange(cursor, cursor);
  ta.focus();
  run();
}

let timer = null;
const queueRun = () => { clearTimeout(timer); timer = setTimeout(run, 350); };
els.input.addEventListener('input', queueRun);

let finderTimer = null;
const queueFinder = () => { clearTimeout(finderTimer); finderTimer = setTimeout(runFinder, 250); };
els.seedInput.addEventListener('input', queueFinder);
for (const el of Object.values(constraintEls)) {
  el.addEventListener('input', queueFinder);
  el.addEventListener('change', queueFinder);
}
els.finderClear.addEventListener('click', () => {
  els.seedInput.value = '';
  for (const el of Object.values(constraintEls)) el.value = '';
  runFinder();
});

// Word inspector.
els.annotated.addEventListener('click', (e) => {
  const tok = e.target.closest('.tok.word');
  if (!tok || !lastResult) return;
  const s = lastResult.sentences[Number(tok.dataset.si)];
  const a = s?.ann[Number(tok.dataset.wi)];
  if (a) renderInspector(a, els.inspector);
});

// "Find alternatives" from the inspector: seed the finder with that word.
els.inspector.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-find-word]');
  if (!btn) return;
  els.seedInput.value = btn.dataset.findWord;
  runFinder();
  els.seedInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  els.seedInput.focus();
});

// ---------------------------------------------------------------------------
// Read aloud: system voices instantly; optional neural voice (Kokoro-82M via
// ONNX/WASM) downloaded once and cached by the browser for offline use.

const sp = {
  speak: $('speak-btn'), stop: $('stop-speak'), voice: $('voice-select'),
  rate: $('rate-select'), neural: $('neural-load'), status: $('speech-status'),
};
const neuralTTS = new NeuralTTS();
let speaking = false;

function speechStatus(msg) { sp.status.textContent = msg ?? ''; }

async function populateVoices() {
  const saved = localStorage.getItem('cadence-voice') ?? '';
  sp.voice.innerHTML = '';
  if (systemAvailable()) {
    const voices = await listSystemVoices();
    const en = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'));
    const list = en.length ? en : voices;
    if (list.length) {
      const og = document.createElement('optgroup');
      og.label = 'System voices';
      for (const v of list.slice(0, 30)) {
        const o = document.createElement('option');
        o.value = `sys:${v.voiceURI}`;
        o.textContent = v.name;
        og.appendChild(o);
      }
      sp.voice.appendChild(og);
    }
  }
  if (neuralTTS.state === 'ready') {
    const og = document.createElement('optgroup');
    og.label = 'Neural (offline, cached)';
    for (const [id, label] of NEURAL_VOICES) {
      const o = document.createElement('option');
      o.value = `neu:${id}`;
      o.textContent = label;
      og.appendChild(o);
    }
    sp.voice.appendChild(og);
  }
  if (!sp.voice.options.length) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = 'no voices available';
    sp.voice.appendChild(o);
  }
  if (saved && [...sp.voice.options].some((o) => o.value === saved)) sp.voice.value = saved;
  else if (neuralTTS.state === 'ready') sp.voice.value = `neu:${NEURAL_VOICES[0][0]}`;
}

async function loadNeural() {
  sp.neural.disabled = true;
  try {
    await neuralTTS.load(speechStatus);
    localStorage.setItem('cadence-neural', '1');
    sp.neural.classList.add('hidden');
    await populateVoices();
    speechStatus('neural voice ready — cached for offline use');
    setTimeout(() => speechStatus(''), 4000);
  } catch (e) {
    speechStatus(`neural voice failed to load (${e?.message ?? e}) — system voices still work`);
    sp.neural.disabled = false;
  }
}
sp.neural.addEventListener('click', loadNeural);

function stopSpeaking() {
  stopSystem();
  neuralTTS.stop();
  speaking = false;
  markSpeakingWord(els.annotated, null);
}

async function speakText(text) {
  if (!text.trim()) return;
  stopSpeaking();
  const rate = Number(sp.rate.value) || 1;
  const choice = sp.voice.value;
  const isMainText = text === els.input.value;
  const done = () => { speaking = false; markSpeakingWord(els.annotated, null); };
  speaking = true;
  if (choice.startsWith('neu:')) {
    try {
      speechStatus('synthesizing…');
      await neuralTTS.speak(text, choice.slice(4), done);
      speechStatus('');
    } catch (e) {
      speechStatus(`synthesis failed (${e?.message ?? e})`);
      done();
    }
  } else {
    speakSystem(text, { voiceURI: choice.slice(4) || null, rate },
      isMainText ? (start, len) => markSpeakingWord(els.annotated, start, start + (len || 1)) : null,
      done);
  }
}

sp.speak.addEventListener('click', () => speakText(els.input.value));
sp.stop.addEventListener('click', stopSpeaking);
sp.voice.addEventListener('change', () => localStorage.setItem('cadence-voice', sp.voice.value));
els.inspector.addEventListener('click', (e) => {
  const b = e.target.closest('.wi-speak');
  if (b) speakText(b.dataset.word);
});

populateVoices();
if (localStorage.getItem('cadence-neural') === '1') loadNeural();
else if (!systemAvailable()) speechStatus('no system voices in this browser — load the neural voice to read aloud');

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
