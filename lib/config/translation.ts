import { z } from 'zod'

import { logger } from '@/lib/utils/logger'

import { matcher } from './utils'

/**
 * Translation backend configuration. Mirrors Mastodon's translation feature:
 * one backend is active at a time, selected by `ACTIVITIES_TRANSLATION_TYPE`.
 * The status `POST /api/v1/statuses/:id/translate` endpoint and the
 * `/api/v2/instance` `translation.enabled` flag are driven by this config.
 */
export const DeepLTranslationConfig = z.object({
  type: z.literal('deepl'),
  apiKey: z.string(),
  // DeepL routes free keys to api-free.deepl.com and paid keys to api.deepl.com.
  plan: z.enum(['free', 'pro']).default('free')
})
export type DeepLTranslationConfig = z.infer<typeof DeepLTranslationConfig>

export const LibreTranslateTranslationConfig = z.object({
  type: z.literal('libretranslate'),
  // Base URL of the LibreTranslate server, e.g. https://libretranslate.example
  // or an internal http://libretranslate:5000. API key is optional (public or
  // self-hosted instances may not require one). A reasonably recent
  // LibreTranslate is expected, since a status is translated as a batch (array
  // `q`); the adapter still tolerates an older single-string response.
  endpoint: z.string(),
  apiKey: z.string().optional()
})
export type LibreTranslateTranslationConfig = z.infer<
  typeof LibreTranslateTranslationConfig
>

export const OpenAITranslationConfig = z.object({
  type: z.literal('openai'),
  // Chat-completions endpoint of any OpenAI-compatible API (OpenAI, Azure,
  // local llama.cpp, etc.). The full URL including the path is expected.
  endpoint: z.string(),
  apiKey: z.string(),
  model: z.string()
})
export type OpenAITranslationConfig = z.infer<typeof OpenAITranslationConfig>

export const TranslationConfig = z.discriminatedUnion('type', [
  DeepLTranslationConfig,
  LibreTranslateTranslationConfig,
  OpenAITranslationConfig
])
export type TranslationConfig = z.infer<typeof TranslationConfig>

const getDeepLConfig = (): DeepLTranslationConfig | null => {
  const apiKey = process.env.ACTIVITIES_TRANSLATION_API_KEY
  if (!apiKey) {
    logger.warn(
      'ACTIVITIES_TRANSLATION_TYPE=deepl requires ACTIVITIES_TRANSLATION_API_KEY; translation will be disabled'
    )
    return null
  }

  const plan =
    process.env.ACTIVITIES_TRANSLATION_PLAN === 'pro' ? 'pro' : 'free'
  return { type: 'deepl', apiKey, plan }
}

const getLibreTranslateConfig = (): LibreTranslateTranslationConfig | null => {
  const endpoint = process.env.ACTIVITIES_TRANSLATION_ENDPOINT
  if (!endpoint) {
    logger.warn(
      'ACTIVITIES_TRANSLATION_TYPE=libretranslate requires ACTIVITIES_TRANSLATION_ENDPOINT; translation will be disabled'
    )
    return null
  }

  const apiKey = process.env.ACTIVITIES_TRANSLATION_API_KEY
  return {
    type: 'libretranslate',
    endpoint,
    ...(apiKey ? { apiKey } : {})
  }
}

const getOpenAIConfig = (): OpenAITranslationConfig | null => {
  const endpoint = process.env.ACTIVITIES_TRANSLATION_ENDPOINT
  const apiKey = process.env.ACTIVITIES_TRANSLATION_API_KEY
  const model = process.env.ACTIVITIES_TRANSLATION_MODEL
  if (!endpoint || !apiKey || !model) {
    logger.warn(
      'ACTIVITIES_TRANSLATION_TYPE=openai requires ACTIVITIES_TRANSLATION_ENDPOINT, ACTIVITIES_TRANSLATION_API_KEY and ACTIVITIES_TRANSLATION_MODEL; translation will be disabled'
    )
    return null
  }

  return { type: 'openai', endpoint, apiKey, model }
}

export const getTranslationConfig = (): {
  translation: TranslationConfig
} | null => {
  if (!matcher('ACTIVITIES_TRANSLATION_')) return null

  const type = process.env.ACTIVITIES_TRANSLATION_TYPE
  if (!type) {
    logger.warn(
      'ACTIVITIES_TRANSLATION_TYPE is not set; translation will be disabled'
    )
    return null
  }

  switch (type) {
    case 'deepl': {
      const config = getDeepLConfig()
      return config ? { translation: config } : null
    }
    case 'libretranslate': {
      const config = getLibreTranslateConfig()
      return config ? { translation: config } : null
    }
    case 'openai': {
      const config = getOpenAIConfig()
      return config ? { translation: config } : null
    }
    default:
      logger.warn(
        `Unknown ACTIVITIES_TRANSLATION_TYPE value "${type}"; translation will be disabled`
      )
      return null
  }
}
