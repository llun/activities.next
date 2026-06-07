import { OpenAITranslationConfig } from '@/lib/config/translation'
import { fetchTranslationHttpClient } from '@/lib/services/translation/httpClient'
import { LLM_SUPPORTED_LANGUAGES } from '@/lib/services/translation/languages'
import {
  TranslationHttpClient,
  TranslationProvider,
  TranslationProviderError,
  TranslationResult,
  normalizeLanguageCode
} from '@/lib/services/translation/types'

const REQUEST_TIMEOUT_MS = 30000

const SYSTEM_PROMPT = [
  'You are a translation engine for social media posts.',
  'You receive a JSON object: { "target": <ISO 639-1 code>, "texts": <array of strings> }.',
  'Each string may contain HTML. Translate only the human-readable text nodes into the target language.',
  'Preserve all HTML tags, attributes, links, @mentions and #hashtags exactly as given.',
  'Respond with ONLY a JSON object of the form',
  '{ "translations": <array of translated strings, same order and length as the input>,',
  '"detected_source_language": <ISO 639-1 code of the original language> }.',
  'Do not add explanations or wrap the JSON in code fences.'
].join(' ')

interface OpenAIChatResponse {
  choices?: { message?: { content?: string } }[]
}

interface LLMTranslationPayload {
  translations?: unknown
  detected_source_language?: unknown
}

const parseLLMContent = (
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

/**
 * LLM backend using any OpenAI-compatible chat-completions endpoint. The model
 * is instructed to preserve HTML markup and return structured JSON. Supported
 * languages are a broad fixed list since LLMs handle effectively any language.
 */
export const createOpenAIProvider = (
  config: OpenAITranslationConfig,
  httpClient: TranslationHttpClient = fetchTranslationHttpClient
): TranslationProvider => {
  const supported = [...LLM_SUPPORTED_LANGUAGES]

  return {
    providerName: config.model,
    cacheKey: `openai:${config.model}`,

    async languages() {
      return { source: supported, target: supported }
    },

    async translate(texts, targetLang): Promise<TranslationResult> {
      const response = await httpClient({
        url: config.endpoint,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: JSON.stringify({
                target: normalizeLanguageCode(targetLang),
                texts
              })
            }
          ]
        }),
        timeoutMs: REQUEST_TIMEOUT_MS
      })

      if (response.statusCode !== 200) {
        throw new TranslationProviderError(
          `LLM translate request failed with status ${response.statusCode}`
        )
      }

      const data = JSON.parse(response.body) as OpenAIChatResponse
      const content = data.choices?.[0]?.message?.content
      if (!content) {
        throw new TranslationProviderError('LLM translation response was empty')
      }

      const { texts: translated, detectedSourceLanguage } = parseLLMContent(
        content,
        texts.length
      )
      return {
        texts: translated,
        detectedSourceLanguage,
        provider: config.model
      }
    }
  }
}
