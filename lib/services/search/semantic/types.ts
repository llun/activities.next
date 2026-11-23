export type EmbeddingKind = 'query' | 'document'

export interface EmbeddingRequestOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

export interface EmbeddingProvider {
  readonly cacheKey: string
  readonly model: string
  readonly dimensions: number
  readonly maxBatchSize: number
  embed(
    texts: string[],
    kind: EmbeddingKind,
    options?: EmbeddingRequestOptions
  ): Promise<number[][]>
}

export interface EmbeddingProviderErrorOptions {
  statusCode?: number
  retryable: boolean
}

export class EmbeddingProviderError extends Error {
  readonly statusCode?: number
  readonly retryable: boolean

  constructor(message: string, options: EmbeddingProviderErrorOptions) {
    super(message)
    this.name = 'EmbeddingProviderError'
    this.statusCode = options.statusCode
    this.retryable = options.retryable
  }
}
