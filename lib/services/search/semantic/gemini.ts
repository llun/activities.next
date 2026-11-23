import { GeminiSearchEmbeddingsConfig } from '@/lib/config/searchEmbeddings'
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

export const GEMINI_MAX_BATCH_SIZE = 100

interface GeminiBatchEmbedRequest {
  model: string
  content: {
    parts: Array<{ text: string }>
  }
  taskType?: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT'
  outputDimensionality: number
}

interface GeminiBatchEmbedResponse {
  embeddings?: Array<{
    values?: unknown
  }>
}

const isGeminiEmbedding2Model = (model: string): boolean =>
  model.startsWith('gemini-embedding-2')

const buildGeminiRequest = (
  model: string,
  dimensions: number,
  text: string,
  kind: EmbeddingKind
): GeminiBatchEmbedRequest => {
  if (isGeminiEmbedding2Model(model)) {
    const prefixedText =
      kind === 'query'
        ? `task: search result | query: ${text}`
        : `title: none | text: ${text}`
    return {
      model: `models/${model}`,
      content: { parts: [{ text: prefixedText }] },
      outputDimensionality: dimensions
    }
  }

  return {
    model: `models/${model}`,
    content: { parts: [{ text }] },
    taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
    outputDimensionality: dimensions
  }
}

export const createGeminiEmbeddingProvider = (
  config: GeminiSearchEmbeddingsConfig,
  fetcher: SafeRemoteFetch = safeRemoteFetch
): EmbeddingProvider => {
  const endpoint = config.endpoint.replace(/\/+$/, '')
  const url = `${endpoint}/models/${encodeURIComponent(config.model)}:batchEmbedContents`

  return {
    cacheKey: `gemini:${config.model}:${config.dimensions}`,
    model: config.model,
    dimensions: config.dimensions,
    maxBatchSize: config.batchSize,

    async embed(
      texts: string[],
      kind: EmbeddingKind,
      options?: EmbeddingRequestOptions
    ): Promise<number[][]> {
      if (texts.length === 0) return []

      const results: number[][] = []
      const timeoutInMilliseconds = options?.timeoutMs ?? config.timeoutMs
      const headers: Record<string, string> = {
        'x-goog-api-key': config.apiKey,
        'Content-Type': 'application/json'
      }

      for (const batch of chunkTexts(texts, config.batchSize)) {
        const requests = batch.map((text) =>
          buildGeminiRequest(config.model, config.dimensions, text, kind)
        )

        let response
        try {
          response = await fetcher({
            url,
            method: 'POST',
            headers,
            body: JSON.stringify({ requests }),
            timeoutInMilliseconds,
            maxBodyBytes: MAX_EMBEDDING_RESPONSE_BYTES,
            allowCrossHostRedirects: false,
            maxRedirects: 0,
            ...(options?.signal ? { signal: options.signal } : {})
          })
        } catch (error) {
          throw createTransportEmbeddingError({
            error,
            providerLabel: 'Gemini',
            secret: config.apiKey
          })
        }

        if (response.statusCode !== 200) {
          throw createHttpEmbeddingError({
            body: response.body,
            providerLabel: 'Gemini',
            secret: config.apiKey,
            statusCode: response.statusCode
          })
        }

        const payload = parseEmbeddingJson<GeminiBatchEmbedResponse>(
          response.body,
          'Gemini'
        )
        if (
          !Array.isArray(payload.embeddings) ||
          payload.embeddings.length !== batch.length
        ) {
          throw new EmbeddingProviderError(
            `Gemini embeddings response returned ${Array.isArray(payload.embeddings) ? payload.embeddings.length : 0} vectors, expected ${batch.length}`,
            { retryable: false }
          )
        }

        for (const item of payload.embeddings) {
          results.push(
            validateEmbeddingVector(item?.values, config.dimensions, 'Gemini')
          )
        }
      }

      return results
    }
  }
}
