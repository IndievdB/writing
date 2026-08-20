// Text-to-speech: two tiers.
//
// 1. System voices (Web Speech API) — instant, no download, and 'boundary'
//    events let the UI highlight the word being spoken.
// 2. Neural voice (Kokoro-82M ONNX via kokoro-js) — opt-in ~90 MB download,
//    cached in the browser's Cache API by transformers.js, so it works
//    offline on later visits. Runs fully client-side (WASM).

const CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm',
  'https://esm.sh/kokoro-js@1.2.1',
];
const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export const NEURAL_VOICES = [
  ['af_heart', 'Heart (US female)'],
  ['af_bella', 'Bella (US female)'],
  ['am_michael', 'Michael (US male)'],
  ['am_fenrir', 'Fenrir (US male)'],
  ['bf_emma', 'Emma (UK female)'],
  ['bm_george', 'George (UK male)'],
];

// ---------------------------------------------------------------------------
// System tier

export function systemAvailable() {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function listSystemVoices() {
  return new Promise((resolve) => {
    if (!systemAvailable()) return resolve([]);
    const got = speechSynthesis.getVoices();
    if (got.length) return resolve(got);
    let settled = false;
    speechSynthesis.addEventListener('voiceschanged', () => {
      if (!settled) { settled = true; resolve(speechSynthesis.getVoices()); }
    }, { once: true });
    setTimeout(() => { if (!settled) { settled = true; resolve(speechSynthesis.getVoices()); } }, 1500);
  });
}

// Speak with the OS voice. onWord(charIndex, charLength) fires per word when
// the engine reports boundaries; onDone always fires (end, error, or cancel).
export function speakSystem(text, { voiceURI = null, rate = 1 } = {}, onWord = null, onDone = null) {
  if (!systemAvailable()) { onDone?.('unsupported'); return null; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  if (voiceURI) {
    const v = speechSynthesis.getVoices().find((x) => x.voiceURI === voiceURI);
    if (v) u.voice = v;
  }
  if (onWord) {
    u.addEventListener('boundary', (e) => {
      if (e.name === 'word' || e.charLength > 0) onWord(e.charIndex, e.charLength ?? 0);
    });
  }
  u.addEventListener('end', () => onDone?.(null));
  u.addEventListener('error', (e) => onDone?.(e.error === 'canceled' || e.error === 'interrupted' ? null : e.error));
  speechSynthesis.speak(u);
  return u;
}

export function stopSystem() {
  if (systemAvailable()) speechSynthesis.cancel();
}

// ---------------------------------------------------------------------------
// Neural tier

// Float32 PCM -> WAV blob (mono, 16-bit). Built by hand so we don't depend on
// library helpers that may change shape between versions.
function pcmToWavBlob(samples, sampleRate) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const wr = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); wr(8, 'WAVE');
  wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true); dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  wr(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export class NeuralTTS {
  constructor() {
    this.state = 'idle'; // idle | loading | ready | error
    this.tts = null;
    this.error = null;
    this.audioEl = null;
    this.cache = new Map(); // text|voice -> object URL (session-scoped)
  }

  // Download (or pull from browser cache) the model. onProgress(text).
  async load(onProgress) {
    if (this.state === 'ready' || this.state === 'loading') return;
    this.state = 'loading';
    this.error = null;
    try {
      let mod = null, lastErr = null;
      for (const url of CDN_URLS) {
        try { mod = await import(url); break; }
        catch (e) { lastErr = e; }
      }
      if (!mod) throw lastErr ?? new Error('CDN unreachable');
      onProgress?.('downloading model (cached after first load)…');
      const seen = new Map();
      this.tts = await mod.KokoroTTS.from_pretrained(KOKORO_MODEL, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total) {
            seen.set(p.file, [p.loaded, p.total]);
            let loaded = 0, total = 0;
            for (const [l, t] of seen.values()) { loaded += l; total += t; }
            onProgress?.(`downloading voice model… ${Math.round((loaded / total) * 100)}% of ${Math.round(total / 1e6)} MB`);
          }
        },
      });
      this.state = 'ready';
      onProgress?.(null);
    } catch (e) {
      this.state = 'error';
      this.error = e?.message ?? String(e);
      onProgress?.(null);
      throw e;
    }
  }

  async speak(text, voiceId, onDone = null) {
    if (this.state !== 'ready') throw new Error('neural voice not loaded');
    this.stop();
    const key = `${voiceId}|${text}`;
    let url = this.cache.get(key);
    if (!url) {
      const audio = await this.tts.generate(text, { voice: voiceId });
      const samples = audio.audio ?? audio.data ?? audio;
      const rate = audio.sampling_rate ?? audio.sampleRate ?? 24000;
      url = URL.createObjectURL(pcmToWavBlob(samples, rate));
      if (this.cache.size > 40) {
        const first = this.cache.keys().next().value;
        URL.revokeObjectURL(this.cache.get(first));
        this.cache.delete(first);
      }
      this.cache.set(key, url);
    }
    this.audioEl = new Audio(url);
    this.audioEl.addEventListener('ended', () => onDone?.(null));
    this.audioEl.addEventListener('error', () => onDone?.('playback failed'));
    await this.audioEl.play();
  }

  stop() {
    if (this.audioEl) { this.audioEl.pause(); this.audioEl = null; }
  }
}
