import { OpenAISearchEmbeddingsConfig } from '@/lib/config/searchEmbeddings'
import { SafeRemoteFetch, safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import {
  MAX_EMBEDDING_RESPONSE_BYTES,
  chunkTexts,
  createHttpEmbeddingError,
  createTransportEmbeddingError,
  parseEmbeddingJson,
  validateEmbeddingVector
} from './shared'
import {
  EmbeddingKind,
  EmbeddingProvider,
  EmbeddingProviderError,
  EmbeddingRequestOptions
} from './types'

// OpenAI's own batch size (the configured default for api.openai.com).
export const OPENAI_DEFAULT_BATCH_SIZE = 64

// The name errors carry: the provider behind the endpoint when it is a known
// one, else the API shape.
const providerLabelFor = (endpoint: string) => {
  const host = new URL(endpoint).hostname.toLowerCase()
  if (host === 'api.mistral.ai') return 'Mistral'
  if (host === 'api.openai.com') return 'OpenAI'
  return 'OpenAI-compatible'
}

interface OpenAIEmbeddingsResponse {
  data?: Array<{
    index?: unknown
    embedding?: unknown
  }>
}

export const createOpenAIEmbeddingProvider = (
  config: OpenAISearchEmbeddingsConfig,
  fetcher: SafeRemoteFetch = safeRemoteFetch
): EmbeddingProvider => {
  const endpoint = config.endpoint.replace(/\/+$/, '')
  const url = `${endpoint}/embeddings`
  const label = providerLabelFor(endpoint)
  const batchSize = config.batchSize
  const sizeField =
    config.dimensionsField === 'none'
      ? {}
      : { [config.dimensionsField]: config.dimensions }

  return {
    cacheKey: `openai:${endpoint}:${config.model}:${config.dimensions}`,
    model: config.model,
    dimensions: config.dimensions,
    maxBatchSize: batchSize,

    async embed(
      texts: string[],
      _kind: EmbeddingKind,
      options?: EmbeddingRequestOptions
    ): Promise<number[][]> {
      if (texts.length === 0) return []

      const results: number[][] = []
      const timeoutInMilliseconds = options?.timeoutMs ?? config.timeoutMs
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      }

      for (const batch of chunkTexts(texts, batchSize)) {
        let response
        try {
          response = await fetcher({
            url,
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: config.model,
              input: batch,
              ...sizeField
            }),
            timeoutInMilliseconds,
            maxBodyBytes: MAX_EMBEDDING_RESPONSE_BYTES,
            allowCrossHostRedirects: false,
            maxRedirects: 0,
            ...(options?.signal ? { signal: options.signal } : {})
          })
        } catch (error) {
          throw createTransportEmbeddingError({
            error,
            providerLabel: label,
            secret: config.apiKey
          })
        }

        if (response.statusCode !== 200) {
          throw createHttpEmbeddingError({
            body: response.body,
            providerLabel: label,
            secret: config.apiKey,
            statusCode: response.statusCode
          })
        }

        const payload = parseEmbeddingJson<OpenAIEmbeddingsResponse>(
          response.body,
          label
        )
        if (
          !Array.isArray(payload.data) ||
          payload.data.length !== batch.length
        ) {
          throw new EmbeddingProviderError(
            `${label} embeddings response returned ${Array.isArray(payload.data) ? payload.data.length : 0} vectors, expected ${batch.length}`,
            { retryable: false }
          )
        }

        const ordered: Array<number[] | undefined> = new Array(batch.length)
        for (const item of payload.data) {
          if (
            !item ||
            typeof item !== 'object' ||
            typeof item.index !== 'number' ||
            !Number.isInteger(item.index) ||
            item.index < 0 ||
            item.index >= batch.length ||
            ordered[item.index] !== undefined
          ) {
            throw new EmbeddingProviderError(
              `${label} embeddings response had invalid or duplicate item indices`,
              { retryable: false }
            )
          }

          ordered[item.index] = validateEmbeddingVector(
            item.embedding,
            config.dimensions,
            label
          )
        }

        for (const vector of ordered) {
          if (!vector) {
            throw new EmbeddingProviderError(
              `${label} embeddings response was missing an embedding vector`,
              { retryable: false }
            )
          }
          results.push(vector)
        }
      }

      return results
    }
  }
}
