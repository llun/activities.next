import { AltTextHttpClient, AltTextProviderError } from './types'

const MAX_RESPONSE_BYTES = 1 * 1024 * 1024

const TOO_LARGE_MESSAGE = 'Alt text backend response too large'

/**
 * Reads the response body incrementally, aborting as soon as the accumulated
 * bytes exceed the cap.
 */
const readCappedBody = async (response: Response): Promise<string> => {
  if (typeof response.body?.getReader !== 'function') {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new AltTextProviderError(TOO_LARGE_MESSAGE)
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
        throw new AltTextProviderError(TOO_LARGE_MESSAGE)
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return text + decoder.decode()
}

/**
 * Default alt text HTTP client backed by the platform `fetch`. Applies a
 * per-request timeout via `AbortSignal.timeout` and a streaming response-size
 * cap.
 */
export const fetchAltTextHttpClient: AltTextHttpClient = async ({
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
    throw new AltTextProviderError(
      `Alt text backend request failed: ${(error as Error).message}`
    )
  }

  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new AltTextProviderError(TOO_LARGE_MESSAGE)
  }

  return { statusCode: response.status, body: await readCappedBody(response) }
}
