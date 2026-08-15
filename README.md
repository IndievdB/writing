# Cadence — sentence flow analyzer

A static web app that grades the flow and choppiness of prose — no LLM, no
server, nothing leaves the browser. Paste a fragment, a sentence, or a few
sentences and get:

- a **flow score** with five category meters (rhythm, sound, word choice,
  syntax, shape),
- a **rhythm strip** showing every syllable's stress, with stress clashes
  marked,
- **annotated text** with four lenses (problems, stress, sounds, etymology),
- **located findings** — each anchored to the exact words, each with a fix
  ("stress clash at *big dog*", "utilize → use", "7 consonants jammed at
  *strengths stripped*"),
- a per-word inspector (phonemes, stress, part of speech, frequency rank,
  concreteness, Latinate/Germanic origin),
- the classic readability formulas, in a table for the curious.

The full catalog of what's measured and why is in [METRICS.md](METRICS.md).

## How it works

Instead of a language model, it uses four data files (built by
`tools/build_data.py`, checked into `data/`):

| File | Source | Gives us |
|---|---|---|
| `cmudict.txt` | [CMU Pronouncing Dictionary 0.7b](https://github.com/Alexir/CMUdict) (BSD) | phonemes + stress for 125k words |
| `pos.txt` | [Eric Brill's tagger lexicon](https://github.com/dariusk/pos-js) (MIT packaging) | part-of-speech roles for 78k words |
| `conc.txt` | [Brysbaert, Warriner & Kuperman concreteness norms](https://github.com/ArtsEngine/concreteness) | how concrete 37k words feel to humans |
| `freq.txt` | [hermitdave FrequencyWords](https://github.com/hermitdave/FrequencyWords) (MIT, OpenSubtitles 2018) | frequency rank of the top 100k words |

On top of that, ~40 rule-based metrics from phonology and style research:
stress-clash and lapse detection, boundary consonant collisions, alliteration /
assonance / accidental rhyme, sibilance and plosive load, Latinate density with
plain-word swaps, modifier pileups, nominalizations, passive approximation,
clause shape, sentence-length variety, and the standard readability formulas.
Every judgment traces to a rule you can read in `js/analyze.js`.

## Run it

It's a plain static site — serve the folder over HTTP (the data files load via
`fetch`, so `file://` won't work):

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

### GitHub Pages

Settings → Pages → Source: **Deploy from a branch** → Branch: `main`, folder
`/ (root)`. The app then lives at `https://<user>.github.io/writing/`.

## Develop

- `node tests/run.mjs` — smoke tests for the analysis engine (run against the
  real data files).
- `python3 tools/build_data.py` — re-fetch sources and rebuild `data/`.
- No build step, no dependencies: vanilla ES modules in `js/`.

## Layout

```
index.html          app shell
css/style.css       styles (light/dark)
js/analyze.js       the metric battery + findings engine
js/phonology.js     ARPAbet syllable/stress/cluster analysis
js/etymology.js     Latinate vs Germanic heuristic
js/lexicon.js       data-file wrapper + OOV fallbacks
js/tokenize.js      tokenizer + sentence splitter
js/wordlists.js     curated word lists (function words, swaps, fillers…)
js/ui.js, main.js   rendering and wiring
data/               built dictionaries (see table above)
tools/              data build script
tests/              node smoke tests
METRICS.md          the full catalog of flow metrics, implemented or not
```
