import { DeepLTranslationConfig } from '@/lib/config/translation'
import { fetchTranslationHttpClient } from '@/lib/services/translation/httpClient'
import {
  TranslationHttpClient,
  TranslationProvider,
  TranslationProviderError,
  TranslationResult,
  normalizeLanguageCode
} from '@/lib/services/translation/types'

const REQUEST_TIMEOUT_MS = 10000

const getBaseUrl = (plan: DeepLTranslationConfig['plan']) =>
  plan === 'pro' ? 'https://api.deepl.com' : 'https://api-free.deepl.com'

interface DeepLTranslateResponse {
  translations?: {
    detected_source_language?: string
    text?: string
  }[]
}

interface DeepLLanguage {
  language?: string
}

/**
 * DeepL backend. Sends `tag_handling=html` so HTML status content keeps its
 * markup, and uppercases the ISO 639-1 target code as DeepL expects.
 * @see https://developers.deepl.com/docs/api-reference/translate
 */
export const createDeepLProvider = (
  config: DeepLTranslationConfig,
  httpClient: TranslationHttpClient = fetchTranslationHttpClient
): TranslationProvider => {
  const baseUrl = getBaseUrl(config.plan)
  const authHeader = `DeepL-Auth-Key ${config.apiKey}`

  const fetchLanguages = async (type: 'source' | 'target') => {
    const response = await httpClient({
      url: `${baseUrl}/v2/languages?type=${type}`,
      method: 'GET',
      headers: { Authorization: authHeader },
      timeoutMs: REQUEST_TIMEOUT_MS
    })
    if (response.statusCode !== 200) {
      throw new TranslationProviderError(
        `DeepL languages request failed with status ${response.statusCode}`
      )
    }
    const languages = JSON.parse(response.body) as DeepLLanguage[]
    return languages
      .map((language) => language.language)
      .filter((code): code is string => Boolean(code))
      .map(normalizeLanguageCode)
  }

  return {
    providerName: 'DeepL.com',
    cacheKey: 'deepl',

    async languages() {
      const [source, target] = await Promise.all([
        fetchLanguages('source'),
        fetchLanguages('target')
      ])
      return { source, target }
    },

    async translate(texts, targetLang): Promise<TranslationResult> {
      const response = await httpClient({
        url: `${baseUrl}/v2/translate`,
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: texts,
          target_lang: normalizeLanguageCode(targetLang).toUpperCase(),
          tag_handling: 'html'
        }),
        timeoutMs: REQUEST_TIMEOUT_MS
      })

      if (response.statusCode !== 200) {
        throw new TranslationProviderError(
          `DeepL translate request failed with status ${response.statusCode}`
        )
      }

      const data = JSON.parse(response.body) as DeepLTranslateResponse
      const translations = data.translations ?? []
      if (translations.length !== texts.length) {
        throw new TranslationProviderError(
          'DeepL returned an unexpected number of translations'
        )
      }

      return {
        texts: translations.map((translation) => translation.text ?? ''),
        detectedSourceLanguage: normalizeLanguageCode(
          translations[0]?.detected_source_language ?? ''
        ),
        provider: 'DeepL.com'
      }
    }
  }
}
