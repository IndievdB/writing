// Node smoke test for the word finder:  node tests/finder.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Lexicon } from '../js/lexicon.js';
import { Finder } from '../js/finder.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, 'data', p), 'utf8');

const lex = new Lexicon();
lex.load({ cmudict: read('cmudict.txt'), pos: read('pos.txt'), conc: read('conc.txt'), freq: read('freq.txt') });
const finder = new Finder(lex);
finder.loadThesaurus(read('thesaurus.txt'));
let curated = false;
try { finder.loadSynonyms(read('synonyms.txt')); curated = true; } catch { /* not built yet */ }

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
};
const words = (rs) => rs.map((r) => r.word);

// Synonym search.
const big = finder.search({ seeds: ['big'] });
check('seeds "big" → large', words(big).includes('large'), words(big).slice(0, 8).join(','));
check('seeds "big" → huge somewhere', words(big).includes('huge'));

// Reverse dictionary: multiple seeds circling a meaning.
const walk = finder.search({ seeds: ['walk', 'slowly'] });
check('"walk slowly" → saunter/amble/stroll', ['saunter', 'amble', 'stroll'].some((w) => words(walk).slice(0, 15).includes(w)),
  words(walk).slice(0, 10).join(','));

// Alliteration constraint: synonyms of happy starting with J sound.
const happyJ = finder.search({ seeds: ['happy'], constraints: { allit: 'j' } });
check('happy + allit j → jovial/joyful/jolly', words(happyJ).some((w) => /^j/.test(w)), words(happyJ).slice(0, 6).join(','));
check('happy + allit j: all start with J sound', happyJ.every((r) => r.info.phon.onset[0] === 'JH'));

// Stress pattern: two syllables, unstressed-stressed (iamb).
const sadIamb = finder.search({ seeds: ['sad'], constraints: { stress: '01' } });
check('sad + stress 01 all match', sadIamb.length > 0 && sadIamb.every((r) => {
  const st = r.info.phon.dictStresses.map((s) => (s >= 1 ? 1 : 0)).join('');
  return st === '01';
}), words(sadIamb).slice(0, 6).join(','));

// Rhyme, seedless.
const rhyme = finder.search({ constraints: { rhyme: 'light' } });
check('rhymes with light', words(rhyme).length >= 5 && words(rhyme).every((w) => w !== 'light'),
  words(rhyme).slice(0, 8).join(','));
check('rhyme results actually rhyme', rhyme.every((r) => r.info.phon.rhymeKey === finder.phon('light').rhymeKey));

// Syllable + texture, seedless.
const soft2 = finder.search({ constraints: { syll: '2', texture: 'soft' } });
check('seedless 2-syll soft words', soft2.length >= 10 && soft2.every((r) => r.info.phon.syllableCount === 2));

// Assonance from a word.
const asson = finder.search({ seeds: ['bright'], constraints: { asson: 'time' } });
check('bright + assonance(time) share AY', asson.every((r) => r.info.phon.stressedVowel === 'AY'),
  words(asson).slice(0, 6).join(','));

// Consonance letters.
const consn = finder.search({ seeds: ['dark'], constraints: { conson: 'm' } });
check('dark + contains M', consn.every((r) => r.info.phon.phones.includes('M')), words(consn).slice(0, 6).join(','));

// Origin + rarity filters.
const germBig = finder.search({ seeds: ['big'], constraints: { origin: 'germanic' } });
check('big + germanic only', germBig.length > 0 && germBig.every((r) => r.info.ety.origin === 'germanic'),
  words(germBig).slice(0, 6).join(','));

// Concrete filter.
const conc = finder.search({ seeds: ['happy'], constraints: { feel: 'concrete' } });
check('happy + concrete have ratings ≥3.5', conc.every((r) => r.info.conc >= 350));

// Empty search returns nothing (no seeds, no constraints).
check('empty query → empty', finder.search({}).length === 0);

// Multi-seed boost: word related to both seeds outranks single-seed match.
const cold = finder.search({ seeds: ['cold', 'wind'] });
check('multi-seed search returns results', cold.length > 0, words(cold).slice(0, 8).join(','));

// No morphological derivatives of the seed in results.
const walkPlain = finder.search({ seeds: ['walk'] });
check('walk: no walking/walkway derivatives', !words(walkPlain).some((w) => /^walk/.test(w)),
  words(walkPlain).slice(0, 10).join(','));

if (curated) {
  const whisper = finder.search({ seeds: ['whisper'] });
  check('curated: whisper → murmur/mutter', ['murmur', 'mutter'].some((w) => words(whisper).slice(0, 10).includes(w)),
    words(whisper).slice(0, 10).join(','));
  check('curated: whisper has rich results', whisper.length >= 12, String(whisper.length));
  const run = finder.search({ seeds: ['run'] });
  check('curated: run → sprint/dash/jog near top', ['sprint', 'dash', 'jog'].some((w) => words(run).slice(0, 10).includes(w)),
    words(run).slice(0, 10).join(','));
  const sad = finder.search({ seeds: ['sad'] });
  check('curated: sad → unhappy/mournful/gloomy', ['unhappy', 'mournful', 'gloomy', 'sorrowful'].some((w) => words(sad).slice(0, 10).includes(w)),
    words(sad).slice(0, 10).join(','));
}

// Inflection-aware search: inflected seeds return same-form results.
if (curated) {
  const faster = finder.search({ seeds: ['faster'] });
  check('faster → quicker/swifter/speedier', ['quicker', 'swifter', 'speedier'].every((w) => words(faster).slice(0, 12).includes(w)),
    words(faster).slice(0, 8).join(','));
  check('faster → periphrastic "more rapidly"', words(faster).some((w) => w.startsWith('more ')));
  check('faster: no bare verbs like accelerate', !words(faster).includes('accelerate') && !words(faster).includes('speed'));
  const fast = finder.search({ seeds: ['fast'] });
  check('fast: no gloss junk (destroyer/black/thunder)', !['destroyer', 'black', 'thunder', 'relax', 'trap'].some((w) => words(fast).includes(w)),
    words(fast).slice(0, 10).join(','));
  const quickly = finder.search({ seeds: ['quickly'] });
  check('quickly → swiftly/rapidly, no fabricated fastly', words(quickly).slice(0, 10).includes('swiftly') && !words(quickly).includes('fastly'),
    words(quickly).slice(0, 8).join(','));
  const walked = finder.search({ seeds: ['walked'] });
  check('walked → strolled/marched (past forms)', ['strolled', 'marched', 'paced'].some((w) => words(walked).slice(0, 10).includes(w)),
    words(walked).slice(0, 8).join(','));
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll finder checks passed');
process.exit(failures ? 1 : 0);
