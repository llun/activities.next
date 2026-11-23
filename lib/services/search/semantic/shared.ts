import { isAbortError } from '@/lib/utils/isAbortError'
import { SafeRemoteFetchError } from '@/lib/utils/safeRemoteFetch'

import { EmbeddingProviderError } from './types'

export const DEFAULT_EMBEDDING_TIMEOUT_MS = 30_000
export const MAX_EMBEDDING_RESPONSE_BYTES = 16 * 1024 * 1024
export const MAX_PROVIDER_ERROR_MESSAGE_LENGTH = 200

const redactSecret = (text: string, secret?: string): string => {
  if (!secret) return text
  return text.split(secret).join('[REDACTED]')
}

const isRetryableStatusCode = (statusCode: number): boolean =>
  statusCode === 408 || statusCode === 429 || statusCode >= 500

const extractProviderErrorMessage = (
  body: string,
  secret?: string
): string | null => {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown }
    }
    const rawMessage = parsed?.error?.message
    if (typeof rawMessage !== 'string') return null
    const cleaned = redactSecret(rawMessage, secret).trim()
    if (!cleaned) return null
    return cleaned.slice(0, MAX_PROVIDER_ERROR_MESSAGE_LENGTH)
  } catch {
    return null
  }
}

export const createHttpEmbeddingError = ({
  body,
  providerLabel,
  secret,
  statusCode
}: {
  body: string
  providerLabel: string
  secret?: string
  statusCode: number
}): EmbeddingProviderError => {
  const providerMessage = extractProviderErrorMessage(body, secret)
  const suffix = providerMessage ? `: ${providerMessage}` : ''
  return new EmbeddingProviderError(
    `${providerLabel} embeddings request failed with status ${statusCode}${suffix}`,
    {
      statusCode,
      retryable: isRetryableStatusCode(statusCode)
    }
  )
}

export const createTransportEmbeddingError = ({
  error,
  providerLabel,
  secret
}: {
  error: unknown
  providerLabel: string
  secret?: string
}): EmbeddingProviderError => {
  const rawMessage =
    error instanceof Error ? error.message : 'Unknown network error'
  const safeMessage = redactSecret(rawMessage, secret)
    .trim()
    .slice(0, MAX_PROVIDER_ERROR_MESSAGE_LENGTH)
  const retryable =
    !(error instanceof SafeRemoteFetchError) && !isAbortError(error)

  return new EmbeddingProviderError(
    `${providerLabel} embeddings request failed: ${safeMessage}`,
    // No `cause`: the transport error can carry the request's headers (the
    // key) and an unredacted message, and the logger would print it.
    { retryable }
  )
}

export const parseEmbeddingJson = <T>(
  body: string,
  providerLabel: string
): T => {
  try {
    return JSON.parse(body) as T
  } catch {
    // No `cause`: a JSON parse error quotes the body.
    throw new EmbeddingProviderError(
      `${providerLabel} embeddings response was not valid JSON`,
      { retryable: false }
    )
  }
}

export const validateEmbeddingVector = (
  vector: unknown,
  expectedDimensions: number,
  providerLabel: string
): number[] => {
  if (!Array.isArray(vector)) {
    throw new EmbeddingProviderError(
      `${providerLabel} embeddings response had an invalid embedding vector`,
      { retryable: false }
    )
  }

  if (vector.length !== expectedDimensions) {
    throw new EmbeddingProviderError(
      `${providerLabel} embeddings response returned ${vector.length} dimensions, expected ${expectedDimensions}`,
      { retryable: false }
    )
  }

  for (const value of vector) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new EmbeddingProviderError(
        `${providerLabel} embeddings response contained a non-finite number`,
        { retryable: false }
      )
    }
  }

  return vector as number[]
}

export const chunkTexts = (
  texts: string[],
  maxBatchSize: number
): string[][] => {
  const chunks: string[][] = []
  for (let i = 0; i < texts.length; i += maxBatchSize) {
    chunks.push(texts.slice(i, i + maxBatchSize))
  }
  return chunks
}
