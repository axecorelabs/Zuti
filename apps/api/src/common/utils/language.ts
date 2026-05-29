function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeLanguageCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return null;
  const primary = normalized.split('-')[0];
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

export function getPreferredLanguageFromMetadata(metadata: unknown): string | null {
  const data = asObject(metadata);
  const languagePreference = asObject(data.languagePreference);
  const customerMemory = asObject(data.customerMemory);

  return (
    normalizeLanguageCode(languagePreference.code)
    ?? normalizeLanguageCode(customerMemory.preferredLanguage)
    ?? null
  );
}

export function detectAffirmativeConfirmation(message: string, languageCode?: string | null): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;

  const baseAffirmatives = new Set([
    'yes',
    'y',
    'yeah',
    'yep',
    'sure',
    'ok',
    'okay',
    'alright',
    'sounds good',
    'please continue',
    'continue',
    'go ahead',
  ]);

  const languageAffirmatives: Record<string, string[]> = {
    es: ['si', 'sí', 'claro', 'vale', 'de acuerdo', 'continua', 'continúa'],
    fr: ['oui', 'd accord', 'bien sur', 'continuez', 'vas y'],
    pt: ['sim', 'claro', 'ok', 'continue', 'pode continuar'],
    de: ['ja', 'klar', 'bitte weiter', 'mach weiter'],
    it: ['si', 'sì', 'certo', 'va bene', 'continua'],
    tr: ['evet', 'tamam', 'olur', 'devam et'],
    ar: ['نعم', 'ايوه', 'أجل', 'تمام'],
    hi: ['haan', 'ha', 'ji', 'theek hai', 'हाँ', 'ठीक है'],
    sw: ['ndio', 'sawa', 'endelea'],
  };

  if (baseAffirmatives.has(normalized)) return true;

  const scoped = languageCode ? languageAffirmatives[languageCode] ?? [] : [];
  const combined = [...scoped, ...Object.values(languageAffirmatives).flat()];

  return combined.some((phrase) => normalized === phrase || normalized.startsWith(`${phrase} `));
}

export function buildLocalizedCsatPositiveMessage(languageCode?: string | null): string {
  const code = normalizeLanguageCode(languageCode) ?? 'en';

  const translations: Record<string, string> = {
    en: 'Great, glad I could help! Feel free to reach out any time.',
    es: 'Genial, me alegra haber ayudado. Escríbenos cuando quieras.',
    fr: 'Parfait, ravi d\'avoir pu vous aider. N\'hésitez pas à nous recontacter.',
    pt: 'Ótimo, fico feliz por ter ajudado. Pode falar conosco quando quiser.',
    de: 'Super, ich freue mich, dass ich helfen konnte. Melden Sie sich jederzeit gern wieder.',
    it: 'Perfetto, sono felice di averti aiutato. Scrivici pure quando vuoi.',
    tr: 'Harika, yardımcı olabildiğime sevindim. İstediğiniz zaman tekrar yazabilirsiniz.',
    ar: 'رائع، يسعدني أنني تمكنت من مساعدتك. يمكنك التواصل معنا في أي وقت.',
    hi: 'बहुत बढ़िया, मुझे खुशी है कि मैं मदद कर पाया। आप कभी भी दोबारा संपर्क कर सकते हैं।',
    sw: 'Vizuri, nimefurahi kuwa ningeweza kusaidia. Unaweza kuwasiliana nasi wakati wowote.',
  };

  return translations[code] ?? translations.en;
}
