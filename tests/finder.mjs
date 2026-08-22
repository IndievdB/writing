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
try { finder.loadDefinitions(read('definitions.txt')); } catch { /* not built yet */ }

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

// Sounds-like with a selected initial consonant at the start = alliteration.
const happyJ = finder.search({ seeds: ['happy'], constraints: { sl: [{ word: 'jolly', sel: [{ ph: 'JH', pos: 'start' }] }] } });
check('happy + JH at start → jovial/joyful', words(happyJ).some((w) => /^j/.test(w)), words(happyJ).slice(0, 6).join(','));
check('happy + JH at start: all start with J sound', happyJ.every((r) => r.info.phon.phones[0] === 'JH'));

// Sounds-like with a selected vowel anywhere = assonance.
const asson2 = finder.search({ seeds: ['bright'], constraints: { sl: [{ word: 'time', sel: [{ ph: 'AY', pos: 'any' }] }] } });
check('bright + AY anywhere: all contain AY', asson2.length > 0 && asson2.every((r) => r.info.phon.phones.includes('AY')),
  words(asson2).slice(0, 6).join(','));

// Sounds-like loose mode: no sounds selected, share ≥2 sounds.
const loose = finder.search({ seeds: ['shine'], constraints: { sl: [{ word: 'silver', sel: [] }] } });
check('shine + sounds-like silver (loose)', loose.length > 0 && loose.every((r) => {
  const set = new Set(r.info.phon.phones);
  return ['S', 'IH', 'L', 'V', 'ER'].filter((x) => set.has(x)).length >= 2;
}), words(loose).slice(0, 6).join(','));

// Sounds-like at the end.
const endM = finder.search({ constraints: { sl: [{ word: 'moon', sel: [{ ph: 'N', pos: 'end' }] }], syll: '1' } });
check('N at end, 1 syllable: all end-region has N', endM.length > 0 && endM.every((r) => {
  const ph = r.info.phon.phones;
  return ph.slice(-3).includes('N');
}), words(endM).slice(0, 6).join(','));

// Stress pattern: two syllables, unstressed-stressed (iamb).
const sadIamb = finder.search({ seeds: ['sad'], constraints: { stress: '01' } });
check('sad + stress 01 all match', sadIamb.length > 0 && sadIamb.every((r) => {
  const st = r.info.phon.dictStresses.map((s) => (s >= 1 ? 1 : 0)).join('');
  return st === '01';
}), words(sadIamb).slice(0, 6).join(','));

// Stress "any" slot: 2 syllables, first stressed, second anything.
const anySlot = finder.search({ seeds: ['happy'], constraints: { stress: '1x' } });
check('happy + stress 1-any: 2 syllables, first stressed', anySlot.length > 0 && anySlot.every((r) => {
  const st = r.info.phon.dictStresses.map((s) => (s >= 1 ? '1' : '0'));
  return st.length === 2 && st[0] === '1';
}), words(anySlot).slice(0, 6).join(','));

// Stress prefix mode: starts stressed-unstressed, any length from 2 up.
const prefix = finder.search({ seeds: ['happy'], constraints: { stress: '10', stressMode: 'prefix' } });
check('happy + starts with DUM-da: prefix matches', prefix.length > 0 && prefix.every((r) => {
  const st = r.info.phon.dictStresses.map((s) => (s >= 1 ? '1' : '0'));
  return st.length >= 2 && st[0] === '1' && st[1] === '0';
}), words(prefix).slice(0, 6).join(','));
check('prefix mode includes longer words', prefix.some((r) => r.info.phon.syllableCount > 2),
  words(prefix.filter((r) => r.info.phon.syllableCount > 2)).slice(0, 4).join(','));

// Rhyme, seedless.
const rhyme = finder.search({ constraints: { rhyme: 'light' } });
check('rhymes with light', words(rhyme).length >= 5 && words(rhyme).every((w) => w !== 'light'),
  words(rhyme).slice(0, 8).join(','));
check('rhyme results actually rhyme', rhyme.every((r) => r.info.phon.rhymeKey === finder.phon('light').rhymeKey));

// Syllable + texture, seedless.
const soft2 = finder.search({ constraints: { syll: '2', texture: 'soft' } });
check('seedless 2-syll soft words', soft2.length >= 10 && soft2.every((r) => r.info.phon.syllableCount === 2));

// Word-type filter.
const bigNouns = finder.search({ seeds: ['big'], constraints: { type: 'N' } });
check('big + nouns only: all noun-capable', bigNouns.length === 0 || bigNouns.every((r) => finder.posCap(r.word.split(' ').pop()).includes('N')));
const sadJ = finder.search({ seeds: ['sad'], constraints: { type: 'J' } });
check('sad + adjectives: gloomy/mournful present', ['gloomy', 'mournful', 'unhappy'].some((w) => words(sadJ).includes(w)),
  words(sadJ).slice(0, 6).join(','));

// Origin + rarity filters.
const germBig = finder.search({ seeds: ['big'], constraints: { origin: 'germanic' } });
check('big + germanic only', germBig.length > 0 && germBig.every((r) => r.info.ety.origin === 'germanic'),
  words(germBig).slice(0, 6).join(','));

// Concrete filter.
const conc = finder.search({ seeds: ['happy'], constraints: { feel: 'concrete' } });
check('happy + concrete have ratings ≥3.5', conc.every((r) => r.info.conc >= 350));

// Empty search returns nothing (no seeds, no constraints).
check('empty query → empty', finder.search({}).length === 0);

// Two words = phrase search: modifier + head.
const youngMan = finder.search({ seeds: ['young', 'man'] });
check('phrase "young man" → boy/lad/youth', ['boy', 'lad', 'youth'].every((w) => words(youngMan).slice(0, 8).includes(w)),
  words(youngMan).slice(0, 8).join(','));
const ranQuickly = finder.search({ seeds: ['ran', 'quickly'] });
check('phrase "ran quickly" → dashed/raced past forms', ['dashed', 'raced', 'sprinted'].filter((w) => words(ranQuickly).includes(w)).length >= 2,
  words(ranQuickly).slice(0, 8).join(','));
const bigHouse = finder.search({ seeds: ['big', 'house'] });
check('phrase "big house" → mansion/manor', ['mansion', 'manor', 'estate'].some((w) => words(bigHouse).slice(0, 8).includes(w)),
  words(bigHouse).slice(0, 8).join(','));

// Multiple comma-separated queries: results of every group, interleaved.
const multi = finder.searchMulti([['big'], ['fast']]);
check('multi "big, fast" → large AND quick near top', words(multi).slice(0, 6).includes('large') && words(multi).slice(0, 6).includes('quick'),
  words(multi).slice(0, 8).join(','));
const multiPhrase = finder.searchMulti([['young', 'man'], ['ran', 'quickly']]);
check('multi phrase groups → boy AND a past run verb', words(multiPhrase).slice(0, 6).includes('boy') &&
  ['bolted', 'raced', 'dashed', 'hastened'].some((w) => words(multiPhrase).slice(0, 6).includes(w)),
  words(multiPhrase).slice(0, 8).join(','));
check('multi results are deduped', new Set(words(multi)).size === multi.length);
check('searchMulti single group = search', words(finder.searchMulti([['big']])).join() === words(finder.search({ seeds: ['big'] })).join());

// Grouped sounds: B and R together at the start = "br-" cluster.
const brGroup = finder.search({
  constraints: {
    sl: [{ word: 'brick', grouped: true, sel: [{ ph: 'B', pos: 'start' }, { ph: 'R', pos: 'any' }] }],
    syll: '1',
  },
});
check('grouped B+R at start: all begin with BR', brGroup.length > 0 &&
  brGroup.every((r) => r.info.phon.phones[0] === 'B' && r.info.phon.phones[1] === 'R'),
  words(brGroup).slice(0, 6).join(','));

// Two sounds-like words at once: constraints from both apply.
const twoSl = finder.search({
  constraints: {
    sl: [
      { word: 'silver', sel: [{ ph: 'S', pos: 'start' }] },
      { word: 'moon', sel: [{ ph: 'UW', pos: 'any' }] },
    ],
  },
});
check('two sounds-like words: S at start AND UW anywhere', twoSl.length > 0 &&
  twoSl.every((r) => {
    const ph = r.info.phon.phones;
    const firstVowel = ph.findIndex((x) => ['AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW'].includes(x));
    return ph.slice(0, firstVowel + 1).includes('S') && ph.includes('UW');
  }), words(twoSl).slice(0, 6).join(','));

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
  check('quickly → rapidly/speedily, no fabricated fastly', ['rapidly', 'speedily'].every((w) => words(quickly).includes(w)) && !words(quickly).includes('fastly'),
    words(quickly).slice(0, 8).join(','));
  const tester = finder.search({ seeds: ['tester'] });
  check('tester → agent nouns, no "more trial"', words(tester).includes('examiner') && !words(tester).some((w) => w.startsWith('more ')),
    words(tester).slice(0, 8).join(','));
  const racer = finder.search({ seeds: ['racer'] });
  check('racer → sprinter/speeder agent forms', ['sprinter', 'speeder'].every((w) => words(racer).includes(w)),
    words(racer).slice(0, 8).join(','));
  const walked = finder.search({ seeds: ['walked'] });
  check('walked → strolled/marched (past forms)', ['strolled', 'marched', 'paced'].some((w) => words(walked).slice(0, 10).includes(w)),
    words(walked).slice(0, 8).join(','));
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll finder checks passed');
process.exit(failures ? 1 : 0);
