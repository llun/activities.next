import { OpenAISearchEmbeddingsConfig } from '@/lib/config/searchEmbeddings'
import { SafeRemoteFetch, safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import {
  DEFAULT_EMBEDDING_TIMEOUT_MS,
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

export const OPENAI_MAX_BATCH_SIZE = 64

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

  return {
    cacheKey: `openai:${config.model}:${config.dimensions}`,
    model: config.model,
    dimensions: config.dimensions,
    maxBatchSize: OPENAI_MAX_BATCH_SIZE,

    async embed(
      texts: string[],
      _kind: EmbeddingKind,
      options?: EmbeddingRequestOptions
    ): Promise<number[][]> {
      if (texts.length === 0) return []

      const results: number[][] = []
      const timeoutInMilliseconds =
        options?.timeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      }

      for (const batch of chunkTexts(texts, OPENAI_MAX_BATCH_SIZE)) {
        let response
        try {
          response = await fetcher({
            url,
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: config.model,
              input: batch,
              dimensions: config.dimensions
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
            providerLabel: 'OpenAI',
            secret: config.apiKey
          })
        }

        if (response.statusCode !== 200) {
          throw createHttpEmbeddingError({
            body: response.body,
            providerLabel: 'OpenAI',
            secret: config.apiKey,
            statusCode: response.statusCode
          })
        }

        const payload = parseEmbeddingJson<OpenAIEmbeddingsResponse>(
          response.body,
          'OpenAI'
        )
        if (
          !Array.isArray(payload.data) ||
          payload.data.length !== batch.length
        ) {
          throw new EmbeddingProviderError(
            `OpenAI embeddings response returned ${Array.isArray(payload.data) ? payload.data.length : 0} vectors, expected ${batch.length}`,
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
              'OpenAI embeddings response had invalid or duplicate item indices',
              { retryable: false }
            )
          }

          ordered[item.index] = validateEmbeddingVector(
            item.embedding,
            config.dimensions,
            'OpenAI'
          )
        }

        for (const vector of ordered) {
          if (!vector) {
            throw new EmbeddingProviderError(
              'OpenAI embeddings response was missing an embedding vector',
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
