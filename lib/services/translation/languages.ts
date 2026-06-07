/**
 * Broad set of ISO 639-1 language codes advertised by the LLM backend. An LLM
 * can translate to/from effectively any of these, so unlike DeepL/LibreTranslate
 * (which expose a concrete `languages()` endpoint) the OpenAI provider returns
 * this fixed list for both source and target.
 */
export const LLM_SUPPORTED_LANGUAGES = [
  'ar',
  'bg',
  'bn',
  'ca',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'es',
  'et',
  'fa',
  'fi',
  'fr',
  'he',
  'hi',
  'hu',
  'id',
  'it',
  'ja',
  'ko',
  'lt',
  'lv',
  'nl',
  'no',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'sv',
  'th',
  'tr',
  'uk',
  'vi',
  'zh'
] as const
