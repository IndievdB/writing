# Cadence — word finder & sentence builder

A static web app for finding the word that fits the meaning *and* the music,
then building the sentence — no LLM, no server, nothing leaves the browser.

**The word finder** searches by meaning and by sound at once:

- type one or more **meaning words** ("walk slowly", "shine bright") —
  synonyms come from 60k WordNet groups, plus a reverse dictionary over their
  definitions,
- constrain the sound: **alliteration** (letters or a word), **assonance**
  (vowel sound of a word), **consonance** (contains sounds), **rhyme**,
  **syllable count**, **stress pattern** (`01` = da-DUM), **texture**
  (soft l/m/n/r vs. hard p/t/k/s), **origin** (Germanic/Latinate), **feel**
  (concrete/abstract), and **rarity**,
- or leave the meaning empty and sweep the whole dictionary by sound alone,
- click a result to insert it into your sentence at the cursor.

**The sentence box** runs live flow analysis as you build: a flow score with
five category meters, a per-syllable rhythm strip with stress clashes marked,
annotated text with four lenses (problems / stress / sounds / etymology),
located findings with suggested fixes, a per-word inspector with a
"find alternatives" jump back into the finder, a revision compare mode, and
shareable URLs. The full catalog of flow metrics is in [METRICS.md](METRICS.md).

## How it works

Instead of a language model, it uses four data files (built by
`tools/build_data.py`, checked into `data/`):

| File | Source | Gives us |
|---|---|---|
| `cmudict.txt` | [CMU Pronouncing Dictionary 0.7b](https://github.com/Alexir/CMUdict) (BSD) | phonemes + stress for 125k words |
| `pos.txt` | [Eric Brill's tagger lexicon](https://github.com/dariusk/pos-js) (MIT packaging) | part-of-speech roles for 78k words |
| `conc.txt` | [Brysbaert, Warriner & Kuperman concreteness norms](https://github.com/ArtsEngine/concreteness) | how concrete 37k words feel to humans |
| `freq.txt` | [hermitdave FrequencyWords](https://github.com/hermitdave/FrequencyWords) (MIT, OpenSubtitles 2018) | frequency rank of the top 100k words |
| `thesaurus.txt` | [WordNet 3](https://wordnet.princeton.edu/) synsets via [zaibacu/thesaurus](https://github.com/zaibacu/thesaurus) + adjective similar-to clusters from [wordnet-db](https://github.com/moos/wordnet-db) (WordNet license) | 61k synonym groups with definitions |

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
- `node tests/finder.mjs` — smoke tests for the word finder.
- `python3 tools/build_data.py` — re-fetch sources and rebuild `data/`.
- No build step, no dependencies: vanilla ES modules in `js/`.

## Layout

```
index.html          app shell
css/style.css       styles (light/dark)
js/finder.js        word finder: synonym/reverse-dictionary search + sound constraints
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
