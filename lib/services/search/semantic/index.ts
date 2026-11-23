import memoize from 'lodash/memoize'

import { getConfig } from '@/lib/config'
import {
  createSafeRemoteFetch,
  safeRemoteFetch
} from '@/lib/utils/safeRemoteFetch'

import { GEMINI_MAX_BATCH_SIZE, createGeminiEmbeddingProvider } from './gemini'
import { OPENAI_MAX_BATCH_SIZE, createOpenAIEmbeddingProvider } from './openai'
import { EmbeddingProvider } from './types'

export const getEmbeddingProvider = memoize((): EmbeddingProvider | null => {
  const { searchEmbeddings } = getConfig()
  if (!searchEmbeddings) return null

  const fetcher = searchEmbeddings.allowPrivateEndpoint
    ? createSafeRemoteFetch({ allowPrivateNetwork: true })
    : safeRemoteFetch

  switch (searchEmbeddings.provider) {
    case 'openai':
      return createOpenAIEmbeddingProvider(searchEmbeddings, fetcher)
    case 'gemini':
      return createGeminiEmbeddingProvider(searchEmbeddings, fetcher)
    default:
      return null
  }
})

export {
  GEMINI_MAX_BATCH_SIZE,
  OPENAI_MAX_BATCH_SIZE,
  createGeminiEmbeddingProvider,
  createOpenAIEmbeddingProvider
}
export { EmbeddingProviderError } from './types'
export type {
  EmbeddingKind,
  EmbeddingProvider,
  EmbeddingProviderErrorOptions,
  EmbeddingRequestOptions
} from './types'
