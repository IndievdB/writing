// App wiring: data loading, input handling, theme toggle.
import { Lexicon } from './lexicon.js';
import { analyzeText } from './analyze.js';
import { Finder } from './finder.js';
import { renderResults, renderFinderResults } from './ui.js';
import { systemAvailable, listSystemVoices, speakSystem, stopSystem, NeuralTTS, NEURAL_VOICES } from './speech.js';

const $ = (id) => document.getElementById(id);
const els = {
  input: $('text-input'), status: $('status'), results: $('results'),
  rhythmStrip: $('rhythm-strip'),
  seedInput: $('seed-input'), finderStatus: $('finder-status'),
  finderResults: $('finder-results'), finderClear: $('finder-clear'),
  seedDef: $('seed-def'), slWord: $('c-slword'),
  slPhones: $('sl-phones'), defPopup: $('def-popup'),
  stressChips: $('stress-chips'), stressAdd: $('stress-add'),
  stressClear: $('stress-clear'),
};
const constraintEls = {
  rhyme: $('c-rhyme'), syll: $('c-syll'),
  type: $('c-type'), texture: $('c-texture'), origin: $('c-origin'),
  feel: $('c-feel'), rarity: $('c-rarity'),
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
    rebuildSlChips();
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

// Friendly labels for ARPAbet phonemes on the sound chips.
const PHONE_LABELS = {
  AA: 'ah', AE: 'a', AH: 'uh', AO: 'aw', AW: 'ow', AY: 'eye', EH: 'eh',
  ER: 'er', EY: 'ay', IH: 'ih', IY: 'ee', OW: 'oh', OY: 'oy', UH: 'uu',
  UW: 'oo', B: 'b', CH: 'ch', D: 'd', DH: 'th', F: 'f', G: 'g', HH: 'h',
  JH: 'j', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ng', P: 'p', R: 'r',
  S: 's', SH: 'sh', T: 't', TH: 'th', V: 'v', W: 'w', Y: 'y', Z: 'z', ZH: 'zh',
};
const SL_VOWELS = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);

// Sounds-like state: one entry per typed word. Each sound chip cycles
// off -> anywhere -> at the start -> at the end -> off; a per-word
// "keep together" toggle requires the chosen sounds to be one consecutive run.
let slState = []; // [{word, phones, sel: Map(idx -> 'any'|'start'|'end'), grouped}]
const SL_CYCLE = ['', 'any', 'start', 'end'];
const SL_BADGE = { any: '•', start: '▸', end: '◂' };

function slWords() {
  return els.slWord.value.toLowerCase()
    .split(/[\s,;]+/).map((w) => w.replace(/[^a-z'\-]/g, '')).filter(Boolean)
    .slice(0, 3);
}

function rebuildSlChips() {
  els.slPhones.innerHTML = '';
  slState = [];
  if (!lexicon.ready) return;
  const words = slWords();
  if (!words.length) return;
  const hint = document.createElement('div');
  hint.className = 'sl-hint';
  hint.textContent = 'tap a sound: once = anywhere • twice = at the start ▸ • three times = at the end ◂';
  els.slPhones.appendChild(hint);
  for (const w of words) {
    const block = document.createElement('div');
    block.className = 'sl-block';
    const lbl = document.createElement('span');
    lbl.className = 'sl-wordlbl';
    lbl.textContent = w;
    block.appendChild(lbl);
    const p = finder.phon(w);
    if (!p?.phones?.length) {
      const miss = document.createElement('span');
      miss.className = 'sl-hint';
      miss.textContent = 'not in the pronouncing dictionary';
      block.appendChild(miss);
      els.slPhones.appendChild(block);
      continue;
    }
    const st = { word: w, phones: p.phones, sel: new Map(), grouped: false };
    slState.push(st);
    p.phones.forEach((ph, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `sl-chip ${SL_VOWELS.has(ph) ? 'sl-vowel' : 'sl-conson'}`;
      const base = PHONE_LABELS[ph] ?? ph.toLowerCase();
      const paint = () => {
        const mode = st.sel.get(i) ?? '';
        b.textContent = mode === 'start' ? `▸${base}` : mode === 'end' ? `${base}◂` : base;
        b.classList.toggle('on', !!mode);
        b.setAttribute('aria-pressed', String(!!mode));
        b.title = `${ph}${SL_VOWELS.has(ph) ? ' (vowel)' : ' (consonant)'}` +
          (mode ? ` — must appear ${mode === 'any' ? 'anywhere' : 'at the ' + mode}` : '');
      };
      paint();
      b.addEventListener('click', () => {
        const cur = st.sel.get(i) ?? '';
        const next = SL_CYCLE[(SL_CYCLE.indexOf(cur) + 1) % SL_CYCLE.length];
        if (next) st.sel.set(i, next);
        else st.sel.delete(i);
        paint();
        groupBtn.hidden = st.sel.size < 2;
        if (st.sel.size < 2) { st.grouped = false; groupBtn.classList.remove('on'); }
        queueFinder();
      });
      block.appendChild(b);
    });
    const groupBtn = document.createElement('button');
    groupBtn.type = 'button';
    groupBtn.className = 'sl-group';
    groupBtn.textContent = 'keep together';
    groupBtn.title = 'The chosen sounds must appear side by side, in this order';
    groupBtn.hidden = true;
    groupBtn.addEventListener('click', () => {
      st.grouped = !st.grouped;
      groupBtn.classList.toggle('on', st.grouped);
      queueFinder();
    });
    block.appendChild(groupBtn);
    els.slPhones.appendChild(block);
  }
}

function runFinder() {
  if (!lexicon.ready) return;
  // Multiple meanings are additive: synonyms of every seed, pooled.
  const seeds = els.seedInput.value.toLowerCase()
    .split(/[\s,;]+/).map((s) => s.replace(/[^a-z'\-]/g, '')).filter(Boolean)
    .slice(0, 6);
  const constraints = {};
  for (const [k, el] of Object.entries(constraintEls)) constraints[k] = el ? el.value : '';
  constraints.stress = stressPat.join('');
  constraints.sl = slState.map((st) => ({
    word: st.word,
    grouped: st.grouped,
    sel: [...st.sel.entries()].sort((a, b) => a[0] - b[0])
      .map(([i, pos]) => ({ ph: st.phones[i], pos })),
  }));
  const empty = !seeds.length && !constraints.sl.length && !stressPat.length &&
    Object.values(constraints).every((v) => typeof v !== 'string' || !v.trim());
  const results = empty ? [] : finder.search({ seeds, constraints });
  renderFinderResults(results, els.finderResults, els.finderStatus, insertWord, { empty });

  // Definitions of the seed words, inline under the input.
  const defs = seeds.flatMap((s) => {
    const d = finder.definitionsFor(s, seeds.length > 1 ? 2 : 4);
    return d.map((x) => ({ ...x, of: seeds.length > 1 ? s : x.of }));
  });
  els.seedDef.hidden = !defs.length;
  els.seedDef.innerHTML = defs.map((d) => defLine(d)).join('<br>');
}

const POS_FULL = { N: 'noun', V: 'verb', J: 'adj.', R: 'adv.', '': '' };
const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function defLine(d) {
  const tag = d.pos ? `<i>${POS_FULL[d.pos] ?? ''}</i> ` : '';
  const of = d.of ? ` <span class="def-of">(${escText(d.of)})</span>` : '';
  return `${tag}${escText(d.gloss)}${of}`;
}

// Definition popup on hover/click of a result chip.
let popupTimer = null;
function showPopup(chip) {
  const word = chip.dataset.word;
  if (!word) return;
  const defs = finder.definitionsFor(word.split(' ').pop());
  els.defPopup.innerHTML = `<b>${escText(word)}</b>` +
    (defs.length ? '<br>' + defs.map((d) => defLine(d)).join('<br>')
      : '<br><span class="def-of">no definition found</span>');
  els.defPopup.hidden = false;
  const r = chip.getBoundingClientRect();
  const pw = Math.min(360, window.innerWidth - 24);
  els.defPopup.style.maxWidth = pw + 'px';
  let x = r.left + window.scrollX;
  if (x + pw > window.scrollX + window.innerWidth - 12) x = window.scrollX + window.innerWidth - pw - 12;
  els.defPopup.style.left = x + 'px';
  els.defPopup.style.top = (r.bottom + window.scrollY + 6) + 'px';
}
function hidePopup() {
  clearTimeout(popupTimer);
  els.defPopup.hidden = true;
}
els.finderResults?.addEventListener('mouseover', (e) => {
  const chip = e.target.closest('.word-chip');
  if (!chip) return;
  clearTimeout(popupTimer);
  popupTimer = setTimeout(() => showPopup(chip), 220);
});
els.finderResults?.addEventListener('mouseout', (e) => {
  if (e.target.closest('.word-chip')) hidePopup();
});
window.addEventListener('scroll', hidePopup, { passive: true });

// Insert a found word into the sentence at the cursor, with sane spacing.
function insertWord(word) {
  hidePopup();
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
els.input?.addEventListener('input', queueRun);

let finderTimer = null;
const queueFinder = () => { clearTimeout(finderTimer); finderTimer = setTimeout(runFinder, 250); };
els.seedInput?.addEventListener('input', queueFinder);
els.slWord?.addEventListener('input', () => { rebuildSlChips(); queueFinder(); });

// Stress-pattern builder: visual DUM/da chips instead of 1/0 notation.
let stressPat = []; // e.g. ['1','0'] = DUM-da
function renderStressChips() {
  els.stressChips.innerHTML = '';
  stressPat.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `stress-chip ${s === '1' ? 'st-1' : 'st-0'}`;
    b.textContent = s === '1' ? 'DUM' : 'da';
    b.title = `Syllable ${i + 1}: ${s === '1' ? 'stressed' : 'unstressed'} — click to flip`;
    b.addEventListener('click', () => {
      stressPat[i] = stressPat[i] === '1' ? '0' : '1';
      renderStressChips();
      queueFinder();
    });
    els.stressChips.appendChild(b);
  });
  els.stressClear.hidden = !stressPat.length;
  els.stressAdd.textContent = stressPat.length ? '+' : '+ syllable';
}
els.stressAdd?.addEventListener('click', () => {
  if (stressPat.length >= 6) return;
  // Sensible default: alternate, starting stressed.
  stressPat.push(stressPat.length && stressPat[stressPat.length - 1] === '1' ? '0' : '1');
  renderStressChips();
  queueFinder();
});
els.stressClear?.addEventListener('click', () => {
  stressPat = [];
  renderStressChips();
  queueFinder();
});
for (const el of Object.values(constraintEls)) {
  el?.addEventListener('input', queueFinder);
  el?.addEventListener('change', queueFinder);
}
els.finderClear?.addEventListener('click', () => {
  els.seedInput.value = '';
  els.slWord.value = '';
  stressPat = [];
  renderStressChips();
  rebuildSlChips();
  for (const el of Object.values(constraintEls)) { if (el) el.value = ''; }
  runFinder();
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
sp.neural?.addEventListener('click', loadNeural);

function stopSpeaking() {
  stopSystem();
  neuralTTS.stop();
  speaking = false;
}

async function speakText(text) {
  if (!text.trim()) return;
  stopSpeaking();
  const rate = Number(sp.rate.value) || 1;
  const choice = sp.voice.value;
  const done = () => { speaking = false; };
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
    speakSystem(text, { voiceURI: choice.slice(4) || null, rate }, null, done);
  }
}

sp.speak?.addEventListener('click', () => speakText(els.input.value));
sp.stop?.addEventListener('click', stopSpeaking);
sp.voice?.addEventListener('change', () => localStorage.setItem('cadence-voice', sp.voice.value));

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
