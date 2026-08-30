import {
  TranslationProviderError,
  normalizeLanguageCode
} from '@/lib/services/translation/types'

export const SYSTEM_PROMPT = [
  'You are a translation engine for social media posts.',
  'You receive a JSON object: { "target": <ISO 639-1 code>, "texts": <array of strings> }.',
  'Each string may contain HTML. Translate only the human-readable text nodes into the target language.',
  'Preserve all HTML tags, attributes, links, @mentions and #hashtags exactly as given.',
  'Respond with ONLY a JSON object of the form',
  '{ "translations": <array of translated strings, same order and length as the input>,',
  '"detected_source_language": <ISO 639-1 code of the original language> }.',
  'Do not add explanations or wrap the JSON in code fences.'
].join(' ')

interface LLMTranslationPayload {
  translations?: unknown
  detected_source_language?: unknown
}

export const parseLLMContent = (
  content: string,
  expectedLength: number
): { texts: string[]; detectedSourceLanguage: string } => {
  let payload: LLMTranslationPayload
  try {
    payload = JSON.parse(content) as LLMTranslationPayload
  } catch {
    throw new TranslationProviderError(
      'LLM translation response was not valid JSON'
    )
  }

  const { translations, detected_source_language: detected } = payload
  if (
    !Array.isArray(translations) ||
    translations.length !== expectedLength ||
    !translations.every((text): text is string => typeof text === 'string')
  ) {
    throw new TranslationProviderError(
      'LLM translation response had an unexpected shape'
    )
  }

  return {
    texts: translations,
    detectedSourceLanguage:
      typeof detected === 'string' ? normalizeLanguageCode(detected) : ''
  }
}
