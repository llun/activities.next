import { OpenAITranslationConfig } from '@/lib/config/translation'
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

interface OpenAIChatResponse {
  choices?: { message?: { content?: string } }[]
}

/**
 * LLM backend using any OpenAI-compatible chat-completions endpoint. The model
 * is instructed to preserve HTML markup and return structured JSON. Supported
 * languages are a broad fixed list since LLMs handle effectively any language.
 */
export const createOpenAIProvider = (
  config: OpenAITranslationConfig
): TranslationProvider => {
  const supported = [...LLM_SUPPORTED_LANGUAGES]

  return {
    providerName: config.model,
    cacheKey: `openai:${config.model}`,

    async languages() {
      return { source: supported, target: supported }
    },

    async translate(texts, targetLang): Promise<TranslationResult> {
      let response
      try {
        response = await safeRemoteFetch({
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
          timeoutInMilliseconds: REQUEST_TIMEOUT_MS,
          maxBodyBytes: MAX_RESPONSE_BYTES
        })
      } catch (error) {
        throw new TranslationProviderError(
          `LLM translate request failed: ${(error as Error).message}`
        )
      }

      if (response.statusCode !== 200) {
        throw new TranslationProviderError(
          `LLM translate request failed with status ${response.statusCode}`
        )
      }

      const data = parseTranslationJson<OpenAIChatResponse>(response.body)
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
