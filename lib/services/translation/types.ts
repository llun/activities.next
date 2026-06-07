/**
 * Result of translating a batch of strings. `texts` preserves the order and
 * length of the input array so callers can scatter the results back into the
 * status fields (content, spoiler_text, poll options, media descriptions).
 */
export interface TranslationResult {
  texts: string[]
  // ISO 639-1 code of the detected source language.
  detectedSourceLanguage: string
  // Human-readable provider name surfaced in the Mastodon Translation entity's
  // `provider` field (e.g. "DeepL.com").
  provider: string
}

export interface TranslationLanguages {
  // ISO 639-1 codes the backend can translate from.
  source: string[]
  // ISO 639-1 codes the backend can translate to.
  target: string[]
}

export interface TranslationProvider {
  // Display name for the Translation entity `provider` field.
  readonly providerName: string
  // Stable identifier used as the cache key dimension. Folds the model into the
  // LLM backend (e.g. "openai:gpt-4o-mini") so switching models does not serve
  // stale cached translations.
  readonly cacheKey: string
  languages(): Promise<TranslationLanguages>
  // Translates each entry of `texts` (HTML) into `targetLang` (ISO 639-1).
  translate(texts: string[], targetLang: string): Promise<TranslationResult>
}

export interface TranslationHttpRequest {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
  timeoutMs: number
}

export interface TranslationHttpResponse {
  statusCode: number
  body: string
}

/**
 * Minimal HTTP client for reaching a translation backend. Unlike
 * `safeRemoteFetch`, this intentionally does NOT apply SSRF protections:
 * translation backends are operator-configured trusted infrastructure (same
 * trust class as the SMTP or database host), and self-hosted LibreTranslate is
 * commonly reached over plain HTTP on a private network. Injectable so adapter
 * tests can mock the transport.
 */
export type TranslationHttpClient = (
  request: TranslationHttpRequest
) => Promise<TranslationHttpResponse>

export class TranslationProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TranslationProviderError'
  }
}

/**
 * Raised when the requested target language is not supported by the active
 * backend. Maps to HTTP 403, matching Mastodon's behaviour for ineligible
 * language pairs.
 */
export class UnsupportedTargetLanguageError extends Error {
  constructor(language: string) {
    super(`Target language "${language}" is not supported`)
    this.name = 'UnsupportedTargetLanguageError'
  }
}

// ISO 639-1 codes are two letters; backends sometimes return regional variants
// (DeepL "EN-US", LibreTranslate "pt-BR"). Normalize to the base two-letter
// lower-case code used throughout the status `language` field.
export const normalizeLanguageCode = (code: string): string =>
  code.trim().slice(0, 2).toLowerCase()
