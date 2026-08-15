// Curated word lists used by the analyzer. All lowercase.

// Closed-class function words. Used for: POS disambiguation priority,
// prose-stress demotion of monosyllables, lexical density, clause splitting.
export const FUNCTION_WORDS = new Set(`
a an the this that these those some any each every either neither no another
i you he she it we they me him her us them my your his its our their mine yours
hers ours theirs myself yourself himself herself itself ourselves yourselves
themselves who whom whose which what
am is are was were be been being do does did done have has had having
will would shall should can could may might must ought
and but or nor so yet for
if because although though while when whenever where wherever since unless
until before after as than whether once
in on at by to of from with without within about above below under over
between among through during against across behind beyond beside near off
onto upon toward towards into out up down around past along per via
not there here then also too very just only even still both all most many
much few little more less own same such
`.trim().split(/\s+/));

export const COORDINATORS = new Set(['and', 'but', 'or', 'nor', 'so', 'yet', 'for']);

export const SUBORDINATORS = new Set(`
if because although though while when whenever where wherever since unless
until before after whereas whether once unless provided lest
`.trim().split(/\s+/));

// Pronouns that can head a clause (used in fragment/clause heuristics).
export const SUBJECT_PRONOUNS = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they', 'this', 'that', 'there', 'who']);

export const BE_FORMS = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', "isn't", "aren't", "wasn't", "weren't"]);
export const WEAK_VERBS = new Set([
  ...BE_FORMS,
  'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'done',
  'get', 'gets', 'got', 'gotten', 'getting', 'make', 'makes', 'made', 'making',
  'go', 'goes', 'went', 'going', 'gone', 'occur', 'occurs', 'occurred',
]);

export const FILLERS = new Set([
  'very', 'really', 'quite', 'just', 'rather', 'actually', 'basically',
  'literally', 'definitely', 'certainly', 'totally', 'completely', 'absolutely',
  'extremely', 'incredibly', 'somewhat', 'fairly', 'pretty', 'truly', 'simply',
  'perhaps', 'maybe', 'probably', 'arguably', 'essentially', 'fundamentally',
  'ultimately', 'obviously', 'clearly', 'frankly', 'honestly', 'seriously',
  'kind', 'sort',   // kind of / sort of (checked with following "of")
]);

// Common irregular past participles (for passive detection alongside -ed/-en).
export const IRREGULAR_PARTICIPLES = new Set(`
made done said seen known taken given found told thought shown left felt kept
held brought begun built bought caught chosen drawn driven eaten fallen
forgotten gotten gone grown heard hidden hit hurt laid led lost meant met paid
put read run sent set sold sent shaken shot shut sung sat slept spoken spent
stood stolen struck sworn swept swum thrown understood woken worn won written
broken frozen ridden risen
`.trim().split(/\s+/));

// High-frequency words of Germanic (Old English / Norse) origin whose surface
// form might otherwise trip the Latinate heuristics.
export const GERMANIC_COMMON = new Set(`
answer business evil eleven twelve hundred thousand friend fiend heaven seven
water father mother brother sister daughter weather feather leather gather
together whether other another over under wonder thunder hunger anger finger
winter summer silver yellow willow window widow shadow meadow sorrow narrow
morrow borrow follow fellow hollow swallow harrow arrow marrow
little middle riddle saddle needle beetle bottle brittle settle kettle nettle
handle candle bundle spindle
body many any merry berry cherry
open even given driven woven cloven raven maiden burden garden warden
iron hammer ladder bladder rudder udder
world word sword ward beard heart hearth earth
love above glove shove dove oven cover
knowledge acknowledge
listen hasten fasten christen glisten
bird word work worth worse worst
`.trim().split(/\s+/));

// Unambiguously Latinate/Romance high-frequency words that lack the telltale
// suffixes (so the morphological heuristic would miss them).
export const LATINATE_COMMON = new Set(`
use fact point case place part group number people person area money order
state city power piece round line term unit form focus effort force
very serious common social major minor real royal rural urban local total
final future public private simple single double triple humble noble gentle
able table stable
receive perceive conceive deceive achieve
allow arrive carry cause change chance charge choice claim clear close cost
count course court cover cry
`.trim().split(/\s+/));

// Latinate -> plainer (usually Germanic) swaps. The actionable part of the
// etymology diagnosis.
export const LATINATE_SWAPS = new Map(Object.entries({
  utilize: 'use', utilization: 'use', commence: 'begin', terminate: 'end',
  purchase: 'buy', assist: 'help', assistance: 'help', attempt: 'try',
  obtain: 'get', acquire: 'get', demonstrate: 'show', indicate: 'show',
  sufficient: 'enough', insufficient: 'too little', numerous: 'many',
  additional: 'more', initial: 'first', initiate: 'start', subsequent: 'later',
  subsequently: 'later', prior: 'earlier', previously: 'before',
  approximately: 'about', regarding: 'about', concerning: 'about',
  component: 'part', construct: 'build', fabricate: 'make', transmit: 'send',
  velocity: 'speed', residence: 'home', inquire: 'ask', request: 'ask',
  comprehend: 'grasp', endeavor: 'try', facilitate: 'ease', implement: 'carry out',
  leverage: 'use', methodology: 'method', functionality: 'features',
  individuals: 'people', individual: 'person', requirement: 'need',
  require: 'need', objective: 'goal', modification: 'change', modify: 'change',
  notification: 'notice', notify: 'tell', prioritize: 'rank', remainder: 'rest',
  respond: 'answer', response: 'answer', retain: 'keep', verify: 'check',
  ascertain: 'find out', cognizant: 'aware', expedite: 'speed up',
  necessitate: 'call for', accomplish: 'do', accomplishment: 'feat',
  advantageous: 'helpful', aggregate: 'total', ameliorate: 'improve',
  anticipate: 'expect', apparent: 'clear', ascend: 'climb', descend: 'sink',
  cease: 'stop', collaborate: 'work together', collide: 'crash',
  communicate: 'talk', compensate: 'pay', conclude: 'end', concur: 'agree',
  consume: 'eat', contribute: 'give', decelerate: 'slow', depart: 'leave',
  desire: 'want', determine: 'find', diminish: 'shrink', disseminate: 'spread',
  duplicate: 'copy', elevate: 'raise', eliminate: 'cut', elucidate: 'explain',
  employ: 'use', enumerate: 'count', erroneous: 'wrong', evaluate: 'judge',
  evident: 'plain', examine: 'look at', excavate: 'dig', exhibit: 'show',
  expend: 'spend', fatigue: 'tire', finalize: 'finish', fragment: 'piece',
  frequently: 'often', generate: 'make', immediately: 'at once',
  inception: 'start', incorrect: 'wrong', inexpensive: 'cheap',
  inform: 'tell', interrogate: 'question', locate: 'find',
  magnitude: 'size', maintain: 'keep', manufacture: 'make', minuscule: 'tiny',
  multitude: 'crowd', nevertheless: 'still', numerous: 'many',
  observe: 'watch', operate: 'run', optimal: 'best', option: 'choice',
  perspiration: 'sweat', portion: 'share', position: 'place', possess: 'own',
  proceed: 'go', prohibit: 'ban', purchase: 'buy', relocate: 'move',
  remainder: 'rest', remuneration: 'pay', reside: 'live', residence: 'home',
  select: 'pick', solitary: 'lone', submerge: 'sink', substantial: 'big',
  transform: 'change', transparent: 'clear', transport: 'carry',
  ultimate: 'last', vacant: 'empty', vend: 'sell', visualize: 'picture',
}));

// Morphological signals for the etymology heuristic.
export const LATINATE_SUFFIXES = [
  'tion', 'sion', 'ssion', 'cion', 'ity', 'ety', 'ancy', 'ency', 'ance', 'ence',
  'ment', 'ous', 'ious', 'eous', 'ive', 'ative', 'itive', 'ate', 'ify', 'ise',
  'ize', 'ization', 'isation', 'al', 'ial', 'ual', 'ure', 'able', 'ible',
  'ent', 'ant', 'ory', 'ary', 'arian', 'itude', 'esce', 'escent', 'or', 'ist',
  'ism', 'ic', 'ical', 'ile', 'ine', 'age',
];
export const LATINATE_PREFIXES = [
  'anti', 'circum', 'com', 'con', 'contra', 'counter', 'de', 'dis', 'ex',
  'extra', 'inter', 'intra', 'multi', 'non', 'ob', 'per', 'post', 'pre', 'pro',
  'quasi', 're', 'retro', 'semi', 'sub', 'super', 'trans', 'ultra',
];
export const GERMANIC_SUFFIXES = [
  'ness', 'hood', 'ship', 'dom', 'ful', 'less', 'ly', 'ish', 'ward', 'wise',
  'some', 'fold',
];

// Abbreviations that end with "." but do not end a sentence.
export const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'ave', 'blvd', 'rd',
  'etc', 'vs', 'eg', 'ie', 'cf', 'al', 'inc', 'ltd', 'co', 'corp', 'dept',
  'fig', 'no', 'vol', 'pp', 'ch', 'sec', 'min', 'max', 'approx', 'appt',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct',
  'nov', 'dec', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
]);
