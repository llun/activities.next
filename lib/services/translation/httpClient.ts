import {
  TranslationHttpClient,
  TranslationProviderError
} from '@/lib/services/translation/types'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

const MAX_RESPONSE_BYTES = 1 * 1024 * 1024

/**
 * Default translation HTTP client backed by `safeRemoteFetch`.
 * Applies streaming response-size cap, timeout bounds, and SSRF protection.
 */
export const fetchTranslationHttpClient: TranslationHttpClient = async ({
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
    throw new TranslationProviderError(
      `Translation backend request failed: ${(error as Error).message}`
    )
  }
}
