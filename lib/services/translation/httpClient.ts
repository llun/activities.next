import {
  TranslationHttpClient,
  TranslationProviderError
} from '@/lib/services/translation/types'

// Translation responses are small (a handful of short strings). Cap the body we
// buffer so a misbehaving backend cannot exhaust memory.
const MAX_RESPONSE_BYTES = 1 * 1024 * 1024

/**
 * Default translation HTTP client backed by the platform `fetch`. Applies a
 * per-request timeout via `AbortSignal.timeout` and a response-size cap. No
 * SSRF guard by design — see `TranslationHttpClient`.
 */
export const fetchTranslationHttpClient: TranslationHttpClient = async ({
  url,
  method,
  headers,
  body,
  timeoutMs
}) => {
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    throw new TranslationProviderError(
      `Translation backend request failed: ${(error as Error).message}`
    )
  }

  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new TranslationProviderError('Translation backend response too large')
  }

  const text = await response.text()
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new TranslationProviderError('Translation backend response too large')
  }

  return { statusCode: response.status, body: text }
}
