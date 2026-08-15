// Node smoke test for the analysis engine: loads real data files, runs the
// analyzer on known-choppy and known-smooth text, and sanity-checks output.
//   node tests/run.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Lexicon } from '../js/lexicon.js';
import { analyzeText } from '../js/analyze.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, 'data', p), 'utf8');

const lex = new Lexicon();
lex.load({ cmudict: read('cmudict.txt'), pos: read('pos.txt'), conc: read('conc.txt'), freq: read('freq.txt') });

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
};

// --- Lexicon sanity
check('phones: "phoneme"', lex.phonesFor('phoneme') === 'F OW1 N IY0 M');
check('phones: derived plural', !!lex.phonesFor('zebras'));
check('freq: "the" is top-10', lex.freqRank('the') <= 10);
check('conc: "hammer" concrete', lex.concretenessFor('hammer') > 400);
check('conc: "justice" abstract', lex.concretenessFor('justice') < 300);

// --- Choppy sample: monotone short sentences, stress clashes.
const choppy = 'The big dog barked. The mad cat hissed. The old man yelled. The day went bad.';
const rc = analyzeText(choppy, lex);
check('choppy: parsed 4 sentences', rc.sentences.length === 4);
check('choppy: overall computed', rc.scores.overall >= 0 && rc.scores.overall <= 100, `overall=${rc.scores.overall}`);
check('choppy: monotone-length finding', rc.findings.some((f) => f.id === 'monotone'));
check('choppy: has stress clashes', rc.sentences.some((s) => s.metrics.find((m) => m.id === 'clash' && parseInt(m.value) > 0)));

// --- Latinate sludge sample.
const sludge = 'The implementation of the organizational transformation necessitates the utilization of additional resources.';
const rs = analyzeText(sludge, lex);
check('sludge: latinate finding', rs.findings.some((f) => f.id === 'latinate' || f.id === 'swap'));
check('sludge: nominalization finding', rs.findings.some((f) => f.id === 'nominalization'));
check('sludge: lower rhythm than smooth', rs.scores.overall < 80, `overall=${rs.scores.overall}`);

// --- Smooth sample (published prose, E.B. White-ish).
const smooth = 'When I was a boy, the river ran clear past our house, and we swam in it every warm evening until the light failed.';
const rm = analyzeText(smooth, lex);
check('smooth: single sentence', rm.sentences.length === 1);
check('smooth: scores higher than choppy', rm.scores.overall > rc.scores.overall,
  `smooth=${rm.scores.overall} choppy=${rc.scores.overall}`);
check('smooth: scores higher than sludge', rm.scores.overall > rs.scores.overall,
  `smooth=${rm.scores.overall} sludge=${rs.scores.overall}`);
check('smooth: few major findings', rm.findings.filter((f) => f.severity === 'major').length === 0);

// --- Tongue-twister boundary collisions.
const twister = 'The crisp splash struck sixths stripped strengths.';
const rt = analyzeText(twister, lex);
check('twister: junction finding', rt.findings.some((f) => f.id === 'junction'));
check('twister: low sound score', rt.scores.sound < 70, `sound=${rt.scores.sound}`);

// --- Fragment.
const frag = analyzeText('A cold, gray morning.', lex);
check('fragment: flagged', frag.findings.some((f) => f.id === 'fragment'));

// --- Fillers + passive + expletive.
const weak = analyzeText('There are actually very many issues that were basically caused by the update.', lex);
check('weak: expletive flagged', weak.findings.some((f) => f.id === 'expletive'));
check('weak: filler flagged', weak.findings.some((f) => f.id === 'filler'));
check('weak: passive flagged', weak.findings.some((f) => f.id === 'passive'));

// --- Readability sanity.
check('readability present', rm.readability && rm.readability.fleschEase > 60,
  `flesch=${rm.readability?.fleschEase}`);

// --- Empty / edge inputs must not throw.
for (const edge of ['', '   ', '...', 'Word', 'Dr. Smith went to Washington. He left.', '“Quoted!” she said.', '12345 67']) {
  try { analyzeText(edge, lex); console.log(`PASS  edge input ${JSON.stringify(edge)}`); }
  catch (e) { console.log(`FAIL  edge input ${JSON.stringify(edge)} threw: ${e.message}`); failures++; }
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
