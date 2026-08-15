# Ways to analyze sentence flow and choppiness — without an LLM

Every technique below is computable with dictionaries, phoneme data, and rules —
no machine learning required. Checkmarks (✅) mark techniques implemented in this
app; (—) marks ones documented here for completeness that the app doesn't do yet,
usually because they need a full syntactic parser.

The core resources that unlock most of this:

- **CMU Pronouncing Dictionary** — ARPAbet phonemes with stress digits (0/1/2)
  for 125k words. Unlocks everything phonological: stress, meter, assonance,
  consonance, syllable structure.
- **A POS lexicon** (Brill's tagger lexicon, WordNet indexes) — which
  part-of-speech roles a word can play. Unlocks modifier pileups,
  nominalizations, lexical density.
- **A word-frequency list** — rarity correlates with processing effort and with
  Latinate origin.
- **Concreteness norms** (Brysbaert et al. 2014) — human ratings of how
  concrete/abstract 40k words are.

---

## 1. Rhythm and meter (stress patterns)

English prose has meter whether you plan it or not. Stress data comes from the
CMU dictionary's stress digits: 1 = primary, 2 = secondary, 0 = unstressed.

1. ✅ **Stress contour extraction** — map the sentence to a string like
   `1 0 0 1 0 1 1` and display it. Just *seeing* the contour reveals choppiness.
2. ✅ **Stress clash detection** — two stressed syllables back-to-back across a
   word boundary (`bright light shines`) forces a percussive, effortful read.
   Count clashes per 10 syllables. This is the single strongest predictor of
   perceived choppiness.
3. ✅ **Stress lapse detection** — runs of 3+ unstressed syllables
   (`of the in a for the`) make the sentence mumble and sag.
4. ✅ **Metrical regularity score** — autocorrelation of the stress sequence at
   lag 2 (iambic/trochaic tendency) and lag 3 (anapestic). Moderately regular
   prose flows; perfectly regular prose sing-songs; irregular prose stumbles.
5. ✅ **Cadence (sentence ending)** — does the sentence end on a stressed
   syllable (masculine, emphatic, "final-sounding") or unstressed (feminine,
   trailing)? Prose that always trails feels weak; sentence-final stress lands.
6. ✅ **End-weight check** — English prefers long/heavy constituents at the end.
   Approximation: compare syllable weight of the last quarter of the sentence
   vs. the first quarter. Front-heavy sentences feel like they topple.
7. ✅ **Monosyllable runs** — 4+ single-syllable words in a row
   (`the dog ran to the big red barn`) reads as staccato thumping. Length of the
   longest run and count of runs.
8. ✅ **Polysyllable clustering** — several 3+-syllable words adjacent
   (`institutional organizational effectiveness`) produces sludge. Density and
   adjacency of polysyllabic words.
9. ✅ **Syllables-per-word distribution** — mean and variance. Flow needs
   variety: all-short is choppy, all-long is mud.
10. — **Foot parsing** — actually segment into iambs/trochees/anapests and
    report the dominant foot, like scansion software for poetry (e.g. the
    Scandroid algorithm). Overkill for prose but fully rule-computable.
11. ✅ **Rhythm-variety index** — Shannon entropy of the stress bigram
    distribution; very low entropy = metronomic, very high = jumbled.

## 2. Sound texture (phonaesthetics)

All computed on the ARPAbet phoneme sequence, usually within a sliding window of
2–4 content words, since the ear only holds sounds briefly.

12. ✅ **Alliteration** — repeated initial onset consonants of stressed
    syllables within a short window. Deliberate alliteration binds; accidental
    alliteration distracts (`particularly problematic pricing`).
13. ✅ **Assonance** — repeated stressed-vowel phonemes in nearby words
    (`deep green sea`). Binds words sonically; flag both as a texture score and
    as an accidental-repetition warning.
14. ✅ **Consonance** — repeated consonant sounds anywhere in nearby words
    (`pitter patter`), especially in codas (`black block`).
15. ✅ **Sibilance density** — proportion of S/Z/SH/ZH/CH/JH phonemes. Above
    ~15% the sentence hisses (`she sells sea shells` effect).
16. ✅ **Plosive density** — proportion of P/B/T/D/K/G. High plosive load =
    percussive, "spitty" text; concentrated at word starts it doubles the
    staccato effect of short words.
17. ✅ **Euphony ratio** — liquids + nasals + glides (L/R/M/N/NG/W/Y) vs. harsh
    obstruents. The classic "cellar door" quality is mostly liquids and nasals.
18. ✅ **Consonant-cluster load** — average onset/coda cluster size per word.
    `strengths` = CCCVCCC. Cluster-heavy sentences are physically hard to say,
    and readers subvocalize.
19. ✅ **Word-boundary collision** — the coda of one word + onset of the next
    forms a junction cluster (`crisp splash` = /sp/+/spl/ = 5 consonants).
    Junction size ≥4 consonants is a tongue-twister seam. This is *the* other
    big choppiness driver besides stress clash.
20. ✅ **Geminate boundary (doubled sound)** — same phoneme ends one word and
    starts the next (`gas station`, `black cat`). Forces either an awkward
    lengthening or an elision.
21. ✅ **Hiatus** — vowel ending + vowel beginning (`the idea of a
    apple`-adjacent seams, `saw Anna`). Mild glottal hitch; high hiatus rate
    loosens the line.
22. ✅ **Accidental rhyme** — two nearby words share stressed vowel + everything
    after it (`the plane came in the rain`). In prose this rings a bell you
    didn't mean to ring.
23. ✅ **Echoed endings** — repeated derivational endings in close succession:
    `-tion ... -tion ... -tion`, `-ly ... -ly`, `-ing ... -ing`. Computed on
    spelling + phonemes.
24. ✅ **Word repetition proximity** — the same content lemma twice within ~8
    words (unless deliberate anaphora). Distance-weighted penalty.
25. — **Phonestheme analysis** — clusters like `gl-` (light: glow, glint,
    gleam) or `sn-` (nose: snout, sniff, sneer) carry sound-symbolic tone; a
    lookup table of ~40 phonesthemes can report the sound-symbolic palette of a
    sentence.
26. ✅ **Vowel height/frontness profile** — front-high vowels (EE, IH) read
    "small, bright, quick"; back-low vowels (AA, AO, OW) read "big, slow,
    heavy." Report the sentence's vowel color mix.

## 3. Word choice (lexis)

27. ✅ **Latinate vs. Germanic ratio** — scored per word by morphology
    (suffixes `-tion -ity -ous -ive -ate -ment -ence...`, prefixes `con- trans-
    sub-...`), length, stress pattern, and frequency, with curated exception
    lists. Germanic words punch; Latinate words hedge and formalize. High
    Latinate density is the classic cause of "dead" prose (Orwell's complaint).
28. ✅ **Latinate → Germanic swap suggestions** — a lookup table of ~150 common
    offenders (`utilize→use`, `commence→begin`, `sufficient→enough`) makes the
    diagnosis actionable.
29. ✅ **Concreteness score** — mean Brysbaert rating; flag the most abstract
    words. Concrete words are read faster and remembered better; abstraction is
    a flow-killer disguised as sophistication.
30. ✅ **Word-frequency profile** — mean log frequency rank; flag rare words.
    Rare words cost reading time (well-replicated eye-tracking result). One
    rare word is seasoning; three in a row is a wall.
31. ✅ **Lexical density** — content words ÷ total words. Too high = dense,
    breathless; too low = padded.
32. ✅ **Filler/intensifier count** — `very, really, quite, just, rather,
    actually, basically, literally...` from a stop list. Each one is a dead
    syllable.
33. ✅ **Weak-verb dependence** — density of *be/have/do/get/make/go* forms as
    main verbs. Weak verbs push meaning into nouns and prepositions,
    lengthening the sentence.
34. ✅ **Nominalization detection** — abstract nouns wearing verb clothing
    (`-tion, -ment, -ance, -ency, -ization`); each usually hides a stronger
    verb (`make a decision → decide`).
35. ✅ **Type–token ratio** — vocabulary variety across multiple sentences.
36. — **Age-of-acquisition norms** — Kuperman et al. ratings; early-learned
    words process faster. Same mechanism as frequency, different dataset.
37. — **Collocation strength** — score adjacent word pairs against an n-gram
    table (Google Books, COCA); low-probability pairs read as friction. Needs a
    big n-gram file but no ML.

## 4. Syntax-adjacent (POS patterns, no parser needed)

A POS lexicon plus rule-based disambiguation gets you surprisingly far.

38. ✅ **Modifier pileups** — runs of 2+ adjectives before a noun (`the big old
    rusty broken gate`), adverb+adjective stacks (`incredibly deeply flawed`).
39. ✅ **Adverb density** — especially `-ly` adverbs; each one is a confession
    the verb wasn't strong enough.
40. ✅ **Noun stacks** — 3+ nouns in a row (`customer service response time
    optimization`) — bureaucratic compression that forces re-parsing.
41. ✅ **Preposition chains** — `of the... in the... of the...`; each `of`
    adds a right-branch the reader must hold open.
42. ✅ **Expletive openers** — `There is/are`, `It is ... that` — delays the
    subject, wastes the sentence's strongest position.
43. ✅ **Passive-voice approximation** — form of *be* + past participle
    (POS-checked). Passives add syllables and bury the actor.
44. ✅ **Sentence-opener repetition** — consecutive sentences starting with the
    same word/POS shape (multi-sentence input).
45. ✅ **Determiner–pronoun balance** — pronoun-heavy prose floats free of
    referents; determiner-heavy prose plods.
46. — **Full dependency parse metrics** — the gold standard the above
    approximates. If you ever accept a bigger dependency (still no LLM):
    - **Mean dependency distance** — how far apart grammatically linked words
      sit; long distances strain working memory.
    - **Left-embeddedness / right-branching ratio** — English flows
      right-branching; front-loaded subordination chokes.
    - **Depth of the parse tree**, **constituents before the main verb**
      (Yngve depth, "syntactic suspense").
    - Libraries like spaCy or Stanza do this locally without an LLM.

## 5. Sentence shape and punctuation

47. ✅ **Sentence length (words & syllables)** — with banding: <8 punchy, 8–17
    conversational, 18–30 literary-long, >30 needs a license.
48. ✅ **Sentence-length variety** — standard deviation across sentences; the
    #1 rhythm tool at paragraph scale. Three same-length sentences in a row =
    monotone (Gary Provost's "This sentence has five words" demo is this
    metric).
49. ✅ **Clause segmentation** — split on `, ; : — ( )` plus coordinators
    (and/but/or/so) and subordinators (because/although/when...). Report clause
    count and lengths.
50. ✅ **Clause-length variance** — many short clauses = choppy comma-splice
    feel; one giant clause = breathless.
51. ✅ **Punctuation pause rate** — pauses per word. Commas ≈ half-beat,
    semicolons/dashes ≈ full beat. High rate = hiccupping.
52. ✅ **Breath length** — longest run of syllables with no pause. Readers
    subvocalize; >~30 syllables without a pause physically strains.
53. ✅ **Conjunction-glue analysis** — sentences stitched with `and...and...and`
    (polysyndeton) vs. asyndetic comma strings; both are rhythmic choices, both
    flagged when accidental-looking.
54. ✅ **Fragment detection** — no finite-verb candidate = fragment. Fine
    deliberately. Choppy accidentally.
55. — **Given-before-new / topic continuity** — does each sentence start with
    something already mentioned? Computable with lemma overlap between
    consecutive sentence openings and predecessors.
56. — **Cohesion overlap (Coh-Metrix style)** — noun/argument overlap between
    adjacent sentences; low overlap reads as jumpy.

## 6. Classic readability formulas

All closed-form; each weighs word length vs. sentence length differently.
Useful as coarse dials, not as flow truth.

57. ✅ **Flesch Reading Ease** and ✅ **Flesch–Kincaid Grade**
58. ✅ **Gunning Fog Index** (complex-word ratio)
59. ✅ **SMOG** (polysyllable count)
60. ✅ **Coleman–Liau** (characters per word)
61. ✅ **Automated Readability Index**
62. ✅ **LIX / RIX** (long-word based, language-agnostic)
63. — **Dale–Chall** (needs its 3,000 easy-word list — trivially addable)
64. — **FORCAST** (monosyllable-based, for technical text)

## 7. Information-theoretic and statistical

65. ✅ **Character/word-length entropy** — variance and entropy of word lengths
    as a burstiness signal.
66. — **Surprisal via n-gram language model** — per-word -log P(word|prev 2
    words) from a downloadable n-gram table. Uniform information density reads
    smooth; surprisal spikes read as bumps. The strongest non-LLM flow metric
    if you're willing to ship a ~50MB table. (An LLM is just a better version
    of this; a trigram model is 1979 technology.)
67. — **Compression ratio** — gzip the sentence; highly compressible =
    repetitive phrasing.
68. ✅ **Burstiness of stress** — coefficient of variation of inter-stress
    intervals (isochrony proxy — English tends toward evenly spaced beats;
    wildly uneven spacing = lurching).

## 8. Delivery-based (if you add a speech synthesizer, still no LLM)

69. — **TTS duration modeling** — feed the sentence to a formant/concatenative
    synthesizer, measure pause insertions and phrase-final lengthening.
70. — **Pitch-contour prediction** — rule-based ToBI accent assignment
    predicts where the voice must rise/fall; crowded pitch accents = choppy.

---

## How the app combines these

Raw metrics are diagnostics, not verdicts. The app:

1. computes the full battery per sentence,
2. normalizes each against calibrated "smooth prose" bands (not zero —
   some clash, some Latinate, some length variety is *good*),
3. emits **findings**: located, severity-ranked, human-readable, each anchored
   to the exact words that caused it, each with a suggested repair,
4. rolls categories into five meters — **Rhythm, Sound, Word choice, Syntax,
   Shape** — and one overall flow grade, weighted toward the two strongest
   choppiness predictors: stress clash rate and boundary-collision load.
