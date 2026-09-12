// The sentence-shape library (from the author's cadence table): named
// structures with examples, grouped by narrative function, plus a
// surface-pattern recognizer that tags which shapes a sentence uses.

export const STRUCTURES = [
  // ---- Active ----
  { cat: 'Active', name: 'Basic', ex: 'Bob nocked an arrow.' },
  { cat: 'Active', name: 'Comma', ex: 'Bob nocked an arrow, drew it back to his cheek.', note: 'comma-spliced predicates — a stylistic license' },
  { cat: 'Active', name: 'Comma And', ex: 'Bob nocked an arrow, and drew it back to his cheek.' },
  { cat: 'Active', name: 'Double Comma And', ex: 'Bob nocked an arrow, drew it back to his cheek, and let fly.' },
  { cat: 'Active', name: 'Comma But', ex: 'Bob nocked an arrow, but his fingers fumbled it.' },
  { cat: 'Active', name: 'As/While', ex: 'The deer bolted as the bowstring thrummed.', note: 'use sparingly, and only when the two actions happen at the exact same time' },
  { cat: 'Active', name: 'Semicolon', ex: 'Bob nocked an arrow; he hadn’t caught sight of any prey, but wanted to be ready.' },
  { cat: 'Active', name: 'Double Semicolon', ex: 'His arm trembled; fingers ached; breath eased.' },
  { cat: 'Active', name: 'Semicolon Mirror', ex: 'Bob could not find a clean shot; could not find new ground, and risk a twig breaking underfoot.' },
  { cat: 'Active', name: 'Semicolon Mirror Emphasis', ex: 'Till his lungs burned, Bob chased that wounded deer; till the sun fell and the wolves howled, he chased it.' },
  { cat: 'Active', name: 'Em Dash', ex: 'Bob nocked an arrow — his last broadhead.' },
  { cat: 'Active', name: 'Em Dash Sandwich', ex: 'Bob took aim at the white-tailed deer — an eight-point buck — and let fly.' },
  { cat: 'Active', name: 'Comma Then', ex: 'Bob dropped the first deer with an arrow, then fired at the other.', note: 'use instead of “and” when the second action is directed at something else' },
  { cat: 'Active', name: 'And Comma Then', ex: 'Bob nocked an arrow and crept through the undergrowth, then drew his bow and fired.', note: 'use “then” when there are too many “and”s' },
  { cat: 'Active', name: '-ingVerb Comma', ex: 'Crouching in the ferns, Bob nocked an arrow.' },
  { cat: 'Active', name: 'Comma -ingVerb', ex: 'Bob drew his bow, straining against the weight.' },
  { cat: 'Active', name: 'Comma Lest', ex: 'Bob nocked an arrow, lest he stumble upon a deer unprepared.' },
  { cat: 'Active', name: 'Comma Save', ex: 'All Bob’s fingertips ached, save his pinkie.' },
  { cat: 'Active', name: 'Not a, Nor a', ex: 'Not a bird sang, nor a squirrel skittered.' },
  // ---- Descriptive ----
  { cat: 'Descriptive', name: 'Basic', ex: 'His jacket was brown.' },
  { cat: 'Descriptive', name: 'And', ex: 'His jacket was brown and rugged.' },
  { cat: 'Descriptive', name: 'Comma And', ex: 'His jacket was brown, and his trousers patched.' },
  { cat: 'Descriptive', name: 'Double Comma And', ex: 'His jacket was brown, his trousers patched, and his boots worn.' },
  { cat: 'Descriptive', name: 'Comma Semicolon Comma And', ex: 'His jacket was brown, his trousers patched; his boots worn, and his mittens creased.' },
  { cat: 'Descriptive', name: 'Comma But', ex: 'His jacket was old leather, but it kept him warm enough.' },
  { cat: 'Descriptive', name: 'Colon List', ex: 'Bob’s hunting philosophy was comprised of three things: hunt what you eat, eat what you kill, and don’t kill more than you can eat.' },
  { cat: 'Descriptive', name: 'Colon Elaboration', ex: 'Bob was a troubled man: he drank daily, and cursed often.' },
  { cat: 'Descriptive', name: 'The Hemingway', ex: 'The pines were snow-covered and the day was cold and cloudy and he saw the tracks of rabbits and squirrels, imprinted on the snow, and the stillness of the winter forest was soothing and anything that moved was stark and ruined it.' },
  { cat: 'Descriptive', name: 'Metaphor', ex: 'The snow was a white blanket.' },
  // ---- Hybrid ----
  { cat: 'Hybrid', name: 'Comma Description', ex: 'Bob marched over to the fallen deer, tears in his eyes.', note: 'can reverse' },
  { cat: 'Hybrid', name: 'Comma Double Description', ex: 'Bob marched over to the fallen deer, camouflaged and mud-smeared.', note: 'can reverse' },
  { cat: 'Hybrid', name: 'Sandwiched Description', ex: 'The carcass reeked, its flesh rotten, and flies swarmed around it.' },
  { cat: 'Hybrid', name: 'Double Sandwiched Description', ex: 'The carcass reeked, its flesh rotten, bones gnawed, and flies swarmed around it.' },
  { cat: 'Hybrid', name: 'Semicolon Description', ex: 'Bob marched over to the fallen deer; camouflaged and mud-smeared, he was but another green fixture in this wild place.' },
  { cat: 'Hybrid', name: 'Comma Elaboration', ex: 'Bob huddled against the bitter winds, cold as only the Tundra bred them.' },
  { cat: 'Hybrid', name: 'Simile', ex: 'The arrowhead pierced hide like a cougar’s fangs.' },
  // ---- Continuations ----
  { cat: 'Continuations', name: 'Basic + Comma And', ex: 'Bob nocked an arrow. He drew the feathers to his cheek, and exhaled.' },
  { cat: 'Continuations', name: 'Basic + Comma But', ex: 'Bob nocked an arrow. He drew the feathers to his cheek, but could not send it through the deer’s heart.' },
  { cat: 'Continuations', name: 'Basic + Basic', ex: 'Bob drew the feathers to his cheek. The bow’s limbs groaned.', note: 'often works best when the subject of each sentence is different' },
  { cat: 'Continuations', name: 'Comma And + Comma But', ex: 'Bob nocked an arrow, and drew the feathers to his cheek. He exhaled, but couldn’t send it through the deer’s heart.' },
  { cat: 'Continuations', name: 'Then', ex: 'Bob nocked an arrow and drew it to his cheek. Then sent it through the deer’s heart.', note: 'can use if the previous sentence is split by an “and”' },
  { cat: 'Continuations', name: 'Associated Action', ex: 'Bob drew his bow. Gripped it tight.' },
  { cat: 'Continuations', name: 'Elaboration', ex: 'The arrow pierced the deer’s breast. An inch below its heart.' },
  { cat: 'Continuations', name: 'And', ex: 'Bob nocked an arrow, drew it back to his cheek. And exhaled.' },
  { cat: 'Continuations', name: 'But Period And', ex: 'But Bob’s bow had its limits. And the deer was beyond them.' },
  { cat: 'Continuations', name: 'As did', ex: 'Bob’s nose stung in the cold. As did his bare, bowstring fingers.' },
  // ---- Transitions ----
  { cat: 'Transitions', name: 'But Undesirable Action', ex: 'Bob let fly his arrow. But the deer bolted at the thrum of its release.' },
  { cat: 'Transitions', name: 'But/Yet Revelation', ex: 'Bob nocked an arrow, drew it back to his cheek. But he could not send it into the deer’s heart.', note: '“yet” must build upon previous sentences; “but” need not' },
  { cat: 'Transitions', name: 'But/Yet Still', ex: 'His lungs burned. Heart hammered. Legs ached. But still he ran.' },
  { cat: 'Transitions', name: 'But Not Before', ex: 'Bob let fly his arrow. But not before the deer bolted.' },
  { cat: 'Transitions', name: 'But No Sooner… Than', ex: 'Bob nocked an arrow. But no sooner had he drawn it back, than the deer bolted.' },
  { cat: 'Transitions', name: 'But While', ex: 'Bob let fly his arrow. But while it soared true, the deer bolted at the thrum of his release.', note: 'what follows “but” is desirable' },
  { cat: 'Transitions', name: 'And While', ex: 'Bob let fly his arrow. And while the deer perked up, the arrow pierced its heart before it could flee.', note: 'what follows “and” is undesirable' },
  { cat: 'Transitions', name: 'Until', ex: 'Eyes down, Bob followed the deer’s tracks. Until a growl from behind told him he wasn’t the only hunter in these woods.' },
  { cat: 'Transitions', name: 'However', ex: 'Tim shrieked and ran from the bear. Bob, however, chose to fight.' },
  { cat: 'Transitions', name: 'Meanwhile Comma', ex: 'Meanwhile, the birds sang and the wind whistled.', note: 'works with any conjunctive adverb: besides, however, moreover, nevertheless, still, thus…' },
  { cat: 'Transitions', name: 'Internal Monologue', ex: 'Come on Delilah. Right in the heart. You know the way.' },
];

export const STRUCTURE_CATS = ['Active', 'Descriptive', 'Hybrid', 'Continuations', 'Transitions'];

// Surface-pattern recognizer: which named shapes does this sentence use?
// Conservative — tags only what the punctuation and openers make certain.
const CONJ_ADVERBS = /^(meanwhile|however|besides|moreover|namely|nevertheless|thus|indeed|instead|otherwise|furthermore),/i;

export function detectStructures(text, variety = null) {
  const raw = text.trim();
  const low = ` ${raw.toLowerCase()} `;
  const tags = [];
  const dashes = (raw.match(/—|–|--/g) ?? []).length;
  const semis = (raw.match(/;/g) ?? []).length;
  const commas = (raw.match(/,/g) ?? []).length;
  const ands = (low.match(/\band\b/g) ?? []).length;

  // Sentence-opening continuations / transitions.
  if (/^but no sooner\b/i.test(raw)) tags.push('But No Sooner… Than');
  else if (/^but not before\b/i.test(raw)) tags.push('But Not Before');
  else if (/^but while\b/i.test(raw)) tags.push('But While');
  else if (/^and while\b/i.test(raw)) tags.push('And While');
  else if (/^(but|yet)\b/i.test(raw)) {
    if (/^(but|yet)\s+(still\b|.*\bstill\s)/i.test(raw)) tags.push('But/Yet Still');
    else if (/\.\s*And\b/.test(raw)) tags.push('But Period And');
    else tags.push('But/Yet Revelation');
  } else if (/^and\b/i.test(raw)) tags.push('And');
  else if (/^until\b/i.test(raw)) tags.push('Until');
  else if (/^then\b/i.test(raw)) tags.push('Then');
  else if (/^as did\b/i.test(raw)) tags.push('As did');
  else if (CONJ_ADVERBS.test(raw)) tags.push('Meanwhile Comma');
  if (/,\s*however,/i.test(raw)) tags.push('However');

  if (/:/.test(raw)) {
    const after = raw.split(':')[1] ?? '';
    tags.push((after.match(/,/g) ?? []).length >= 2 && /\b(and|or)\b/i.test(after) ? 'Colon List' : 'Colon Elaboration');
  }
  if (dashes >= 2) tags.push('Em Dash Sandwich');
  else if (dashes === 1) tags.push('Em Dash');
  if (semis >= 2) tags.push('Double Semicolon');
  else if (semis === 1) tags.push('Semicolon');

  if (/,\s*and\b/i.test(raw)) tags.push(commas >= 2 ? 'Double Comma And' : 'Comma And');
  if (/,\s*but\b/i.test(raw)) tags.push('Comma But');
  if (/,\s*then\b/i.test(raw)) tags.push(/\band\b[^,;:]*,\s*then\b/i.test(low) ? 'And Comma Then' : 'Comma Then');
  if (/,\s*lest\b/i.test(raw)) tags.push('Comma Lest');
  if (/,\s*save\b/i.test(raw)) tags.push('Comma Save');
  if (/^not\s+an?\b[^,;]*,\s*nor\b/i.test(raw)) tags.push('Not a, Nor a');
  if (/^[a-z]+ing\b[^.;:]*?,/i.test(raw)) tags.push('-ingVerb Comma');
  if (/,\s*[a-z]+ing\b/i.test(raw)) tags.push('Comma -ingVerb');
  if (/\s(as|while)\s/i.test(raw) && !/^(as|while)\b/i.test(raw) && semis === 0 && commas === 0) tags.push('As/While');
  if (/\slike\s/i.test(low)) tags.push('Simile');
  if (ands >= 4) tags.push('The Hemingway');

  if (variety?.structure?.startsWith('fragment') && !tags.length) {
    // A bare fragment reads as an associated action when it opens on a past-
    // tense verb, an elaboration otherwise.
    tags.push(/^[a-z']+ed\b/i.test(raw) ? 'Associated Action' : 'Elaboration');
  }
  return [...new Set(tags)].slice(0, 4);
}
