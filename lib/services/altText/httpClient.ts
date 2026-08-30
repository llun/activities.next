import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import { AltTextHttpClient, AltTextProviderError } from './types'

const MAX_RESPONSE_BYTES = 1 * 1024 * 1024

/**
 * Default alt text HTTP client backed by `safeRemoteFetch`.
 * Applies streaming response-size cap, timeout bounds, and SSRF protection.
 */
export const fetchAltTextHttpClient: AltTextHttpClient = async ({
  url,
  method,
  headers,
  body,
  timeoutMs
}) => {
  try {
    const result = await safeRemoteFetch({
      url,
      method,
      headers,
      body,
      timeoutInMilliseconds: timeoutMs,
      maxBodyBytes: MAX_RESPONSE_BYTES
    })

    return {
      statusCode: result.statusCode,
      body: result.body
    }
  } catch (error) {
    throw new AltTextProviderError(
      `Alt text backend request failed: ${(error as Error).message}`
    )
  }
}
