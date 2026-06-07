import {
  TranslationHttpClient,
  TranslationProviderError
} from '@/lib/services/translation/types'

// Translation responses are small (a handful of short strings). Cap the body we
// buffer so a misbehaving backend cannot exhaust memory.
const MAX_RESPONSE_BYTES = 1 * 1024 * 1024

const TOO_LARGE_MESSAGE = 'Translation backend response too large'

/**
 * Reads the response body incrementally, aborting as soon as the accumulated
 * bytes exceed the cap. This bounds memory even when the backend omits a
 * `content-length` header or lies about it, instead of buffering the whole body
 * first via `response.text()`.
 */
const readCappedBody = async (response: Response): Promise<string> => {
  // Fall back to a buffered read when no readable stream is available (e.g. an
  // empty body, or a non-streaming Response polyfill in the test environment).
  // The cap is still enforced, just after buffering.
  if (typeof response.body?.getReader !== 'function') {
    const text = await response.text()
    // Compare actual UTF-8 byte length, not UTF-16 code-unit count, so the cap
    // matches the streaming path (which counts bytes) for multi-byte responses.
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new TranslationProviderError(TOO_LARGE_MESSAGE)
    }
    return text
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_RESPONSE_BYTES) {
        throw new TranslationProviderError(TOO_LARGE_MESSAGE)
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return text + decoder.decode()
}

/**
 * Default translation HTTP client backed by the platform `fetch`. Applies a
 * per-request timeout via `AbortSignal.timeout` and a streaming response-size
 * cap. No SSRF guard by design — see `TranslationHttpClient`.
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
    throw new TranslationProviderError(TOO_LARGE_MESSAGE)
  }

  return { statusCode: response.status, body: await readCappedBody(response) }
}
