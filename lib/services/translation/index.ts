import memoize from 'lodash/memoize'

import { getConfig } from '@/lib/config'
import { createDeepLProvider } from '@/lib/services/translation/deepl'
import { createLibreTranslateProvider } from '@/lib/services/translation/libretranslate'
import { createOpenAIProvider } from '@/lib/services/translation/openai'
import {
  TranslationLanguages,
  TranslationProvider
} from '@/lib/services/translation/types'

/**
 * Caches the provider's supported-language list across requests. DeepL and
 * LibreTranslate fetch it over HTTP, so without this every translate call would
 * pay an extra round trip. A rejected lookup is not cached, so a transient
 * failure can be retried.
 */
const withLanguageCache = (
  provider: TranslationProvider
): TranslationProvider => {
  let cached: Promise<TranslationLanguages> | null = null
  return {
    ...provider,
    languages() {
      if (!cached) {
        cached = provider.languages().catch((error) => {
          cached = null
          throw error
        })
      }
      return cached
    }
  }
}

/**
 * Returns the active translation provider, or null when translation is not
 * configured. One backend is active at a time, selected by the discriminated
 * `config.translation.type`. Memoized so the provider (and its languages cache)
 * is reused across requests.
 */
export const getTranslationProvider = memoize(
  (): TranslationProvider | null => {
    const { translation } = getConfig()
    if (!translation) return null

    switch (translation.type) {
      case 'deepl':
        return withLanguageCache(createDeepLProvider(translation))
      case 'libretranslate':
        return withLanguageCache(createLibreTranslateProvider(translation))
      case 'openai':
        return withLanguageCache(createOpenAIProvider(translation))
      default:
        return null
    }
  }
)

export const isTranslationEnabled = (): boolean =>
  getTranslationProvider() !== null

export type {
  TranslationProvider,
  TranslationResult,
  TranslationLanguages
} from '@/lib/services/translation/types'
