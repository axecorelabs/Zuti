export type CsatIntent = 'positive' | 'negative' | 'unclear';

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/[\u2018\u2019\u201b\u2032\u0060\u00b4]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NEGATIVE_EXACT = new Set(['no', 'nope', 'nah', 'not really']);

const NEGATIVE_PHRASES = [
  'not solved',
  'not resolved',
  'not fixed',
  'not helpful',
  'not working',
  'still broken',
  'still not working',
  'still need help',
  'still having issues',
  'still having issue',
  'still have issues',
  'still have issue',
  "didn't help",
  'did not help',
  "doesn't work",
  'does not work',
  "don't work",
  'do not work',
  "isn't working",
  'is not working',
  'need more help',
  'need further help',
  'this did not help',
  'that did not help',
  'this didnt help',
  'that didnt help',
  'frustrated',
  'useless',
  'terrible',
];

const POSITIVE_EXACT = new Set([
  'yes',
  'yep',
  'yeah',
  'thanks',
  'thank you',
  'thank you so much',
  "that's all",
  'thats all',
  "that's it",
  'thats it',
  'nothing else',
  'all good',
  'all set',
  'no more',
  'no more questions',
  "i'm good",
  'im good',
  "we're good",
  'were good',
]);

const POSITIVE_PHRASES = [
  "that'll be all",
  'thatll be all',
  "that'll be all for now",
  'thatll be all for now',
  'that will be all',
  'that will be all for now',
  'that is all',
  'that is all for now',
  'nothing else for now',
  'all set for now',
  'no more questions for now',
  'no further questions',
  'no further questions for now',
  'no other questions',
  'works now',
  'working now',
  'this works',
  'that works',
  'this is resolved',
  'that is resolved',
  'this is solved',
  'that is solved',
  'that helped',
  'you helped',
  'you have helped',
  'helpful thanks',
  'perfect thanks',
  'great thanks',
  'okay thanks',
  'ok thanks',
  'thanks that is all',
  'thank you that is all',
  'thank you that will be all',
  'thank you that will be all for now',
  'thank you no more questions',
  'thank you nothing else for now',
];

const GRATITUDE_WORDS = [
  'thanks',
  'thank you',
  'appreciate it',
  'appreciated',
  'lovely',
  'perfect',
  'great',
  'awesome',
];

const CLOSING_WORDS = [
  "that's all",
  'thats all',
  "that's it",
  'thats it',
  'that is all',
  "that'll be all",
  'thatll be all',
  'that will be all',
  'nothing else',
  'all set',
  'all good',
  'no more',
  'no more questions',
  "i'm good",
  'im good',
  "we're good",
  'were good',
];

export function detectCsatIntent(text: string): CsatIntent {
  const normalized = normalizeText(text);
  if (!normalized) return 'unclear';

  if (NEGATIVE_EXACT.has(normalized)) return 'negative';
  if (NEGATIVE_PHRASES.some((phrase) => normalized.includes(phrase))) return 'negative';

  if (POSITIVE_EXACT.has(normalized)) return 'positive';
  if (POSITIVE_PHRASES.some((phrase) => normalized.includes(phrase))) return 'positive';

  const hasGratitude = GRATITUDE_WORDS.some((word) => normalized.includes(word));
  const hasClosing = CLOSING_WORDS.some((word) => normalized.includes(word));
  if (hasGratitude && hasClosing) return 'positive';

  return 'unclear';
}
