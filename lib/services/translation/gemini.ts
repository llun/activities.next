import { GeminiTranslationConfig } from '@/lib/config/translation'
import { LLM_SUPPORTED_LANGUAGES } from '@/lib/services/translation/languages'
import {
  TranslationProvider,
  TranslationProviderError,
  TranslationResult,
  normalizeLanguageCode,
  parseTranslationJson
} from '@/lib/services/translation/types'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import { SYSTEM_PROMPT, parseLLMContent } from './llmPrompt'

const REQUEST_TIMEOUT_MS = 30000
const MAX_RESPONSE_BYTES = 1 * 1024 * 1024

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
  config: GeminiTranslationConfig
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
      let response
      try {
        response = await safeRemoteFetch({
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
          timeoutInMilliseconds: REQUEST_TIMEOUT_MS,
          maxBodyBytes: MAX_RESPONSE_BYTES
        })
      } catch (error) {
        throw new TranslationProviderError(
          `Gemini translate request failed: ${(error as Error).message}`
        )
      }

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
