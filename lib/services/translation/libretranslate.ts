import { LibreTranslateTranslationConfig } from '@/lib/config/translation'
import { fetchTranslationHttpClient } from '@/lib/services/translation/httpClient'
import {
  TranslationHttpClient,
  TranslationProvider,
  TranslationProviderError,
  TranslationResult,
  normalizeLanguageCode,
  parseTranslationJson
} from '@/lib/services/translation/types'

const REQUEST_TIMEOUT_MS = 20000

interface DetectedLanguage {
  language?: string
}

interface LibreTranslateResponse {
  // When `q` is an array, `translatedText` is an array of the same length.
  // Older instances translating a single string return a bare string instead.
  translatedText?: string | string[]
  // Present when source is "auto": an array (one per input) for batch requests,
  // or a single object for a single-string request.
  detectedLanguage?: DetectedLanguage | DetectedLanguage[]
}

const toArray = <T>(value: T | T[] | undefined): T[] => {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

interface LibreTranslateLanguage {
  code?: string
  targets?: string[]
}

const trimTrailingSlash = (endpoint: string) => endpoint.replace(/\/+$/, '')

/**
 * LibreTranslate backend (self-hosted or hosted). Sends `format=html` so HTML
 * status content is preserved, and `source=auto` for language detection.
 * @see https://libretranslate.com/docs/
 */
export const createLibreTranslateProvider = (
  config: LibreTranslateTranslationConfig,
  httpClient: TranslationHttpClient = fetchTranslationHttpClient
): TranslationProvider => {
  const baseUrl = trimTrailingSlash(config.endpoint)

  return {
    providerName: 'LibreTranslate',
    cacheKey: 'libretranslate',

    async languages() {
      const response = await httpClient({
        url: `${baseUrl}/languages`,
        method: 'GET',
        headers: {},
        timeoutMs: REQUEST_TIMEOUT_MS
      })
      if (response.statusCode !== 200) {
        throw new TranslationProviderError(
          `LibreTranslate languages request failed with status ${response.statusCode}`
        )
      }

      const languages = parseTranslationJson<LibreTranslateLanguage[]>(
        response.body
      )
      const codes = languages
        .map((language) => language.code)
        .filter((code): code is string => Boolean(code))
        .map(normalizeLanguageCode)
      // LibreTranslate lists the same language set as both source and target.
      return { source: codes, target: codes }
    },

    async translate(texts, targetLang): Promise<TranslationResult> {
      const response = await httpClient({
        url: `${baseUrl}/translate`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: texts,
          source: 'auto',
          target: normalizeLanguageCode(targetLang),
          format: 'html',
          ...(config.apiKey ? { api_key: config.apiKey } : {})
        }),
        timeoutMs: REQUEST_TIMEOUT_MS
      })

      if (response.statusCode !== 200) {
        throw new TranslationProviderError(
          `LibreTranslate translate request failed with status ${response.statusCode}`
        )
      }

      const data = parseTranslationJson<LibreTranslateResponse>(response.body)
      // Normalize both the modern array response and the older single-string
      // response into an array so the length check is meaningful.
      const translatedText = toArray(data.translatedText)
      if (translatedText.length !== texts.length) {
        throw new TranslationProviderError(
          'LibreTranslate returned an unexpected number of translations'
        )
      }

      return {
        texts: translatedText,
        detectedSourceLanguage: normalizeLanguageCode(
          toArray(data.detectedLanguage)[0]?.language ?? ''
        ),
        provider: 'LibreTranslate'
      }
    }
  }
}
