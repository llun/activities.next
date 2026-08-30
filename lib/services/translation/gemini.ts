import { GeminiTranslationConfig } from '@/lib/config/translation'
import { fetchTranslationHttpClient } from '@/lib/services/translation/httpClient'
import { LLM_SUPPORTED_LANGUAGES } from '@/lib/services/translation/languages'
import {
  TranslationHttpClient,
  TranslationProvider,
  TranslationProviderError,
  TranslationResult,
  normalizeLanguageCode,
  parseTranslationJson
} from '@/lib/services/translation/types'

import { SYSTEM_PROMPT, parseLLMContent } from './llmPrompt'

const REQUEST_TIMEOUT_MS = 30000

interface GeminiGenerateContentResponse {
  candidates?: {
    content?: {
      parts?: {
        text?: string
      }[]
    }
  }[]
}

/**
 * Gemini translation provider using Google's Generative Language API.
 * Uses structured JSON mode (`responseMimeType: "application/json"`) and
 * `systemInstruction` to translate posts.
 */
export const createGeminiProvider = (
  config: GeminiTranslationConfig,
  httpClient: TranslationHttpClient = fetchTranslationHttpClient
): TranslationProvider => {
  const supported = [...LLM_SUPPORTED_LANGUAGES]
  const endpoint = config.endpoint.replace(/\/$/, '')
  const url = `${endpoint}/models/${config.model}:generateContent`

  return {
    providerName: config.model,
    cacheKey: `gemini:${config.model}`,

    async languages() {
      return { source: supported, target: supported }
    },

    async translate(texts, targetLang): Promise<TranslationResult> {
      const response = await httpClient({
        url,
        method: 'POST',
        headers: {
          'x-goog-api-key': config.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: JSON.stringify({
                    target: normalizeLanguageCode(targetLang),
                    texts
                  })
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json'
          }
        }),
        timeoutMs: REQUEST_TIMEOUT_MS
      })

      if (response.statusCode !== 200) {
        throw new TranslationProviderError(
          `Gemini translate request failed with status ${response.statusCode}`
        )
      }

      const data = parseTranslationJson<GeminiGenerateContentResponse>(
        response.body
      )
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (!content) {
        throw new TranslationProviderError(
          'Gemini translation response was empty'
        )
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
