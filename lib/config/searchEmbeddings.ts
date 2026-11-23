import { z } from 'zod'

import { logger } from '@/lib/utils/logger'

import { matcher } from './utils'

export const DEFAULT_SEARCH_EMBEDDINGS_DIMENSIONS = 768
export const MIN_SEARCH_EMBEDDINGS_DIMENSIONS = 1
export const MAX_SEARCH_EMBEDDINGS_DIMENSIONS = 4000
export const DEFAULT_GEMINI_EMBEDDINGS_MODEL = 'gemini-embedding-001'
export const DEFAULT_GEMINI_EMBEDDINGS_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta'

export const OpenAISearchEmbeddingsConfig = z.object({
  provider: z.literal('openai'),
  endpoint: z.string(),
  apiKey: z.string().optional(),
  model: z.string(),
  dimensions: z
    .number()
    .int()
    .min(MIN_SEARCH_EMBEDDINGS_DIMENSIONS)
    .max(MAX_SEARCH_EMBEDDINGS_DIMENSIONS),
  allowPrivateEndpoint: z.boolean().default(false)
})
export type OpenAISearchEmbeddingsConfig = z.infer<
  typeof OpenAISearchEmbeddingsConfig
>

export const GeminiSearchEmbeddingsConfig = z.object({
  provider: z.literal('gemini'),
  endpoint: z.string(),
  apiKey: z.string(),
  model: z.string(),
  dimensions: z
    .number()
    .int()
    .min(MIN_SEARCH_EMBEDDINGS_DIMENSIONS)
    .max(MAX_SEARCH_EMBEDDINGS_DIMENSIONS),
  allowPrivateEndpoint: z.boolean().default(false)
})
export type GeminiSearchEmbeddingsConfig = z.infer<
  typeof GeminiSearchEmbeddingsConfig
>

export const SearchEmbeddingsConfig = z.discriminatedUnion('provider', [
  OpenAISearchEmbeddingsConfig,
  GeminiSearchEmbeddingsConfig
])
export type SearchEmbeddingsConfig = z.infer<typeof SearchEmbeddingsConfig>

const warnDisabled = (message: string): null => {
  logger.warn({ message })
  return null
}

const parseDimensions = (): number | null => {
  const raw = process.env.ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS?.trim()
  if (!raw) return DEFAULT_SEARCH_EMBEDDINGS_DIMENSIONS

  if (!/^\d+$/.test(raw)) {
    return warnDisabled(
      `ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS must be an integer between ${MIN_SEARCH_EMBEDDINGS_DIMENSIONS} and ${MAX_SEARCH_EMBEDDINGS_DIMENSIONS}; semantic search will be disabled`
    )
  }

  const parsed = Number(raw)
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_SEARCH_EMBEDDINGS_DIMENSIONS ||
    parsed > MAX_SEARCH_EMBEDDINGS_DIMENSIONS
  ) {
    return warnDisabled(
      `ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS must be an integer between ${MIN_SEARCH_EMBEDDINGS_DIMENSIONS} and ${MAX_SEARCH_EMBEDDINGS_DIMENSIONS}; semantic search will be disabled`
    )
  }

  return parsed
}

// The dimensions the setup script builds the table for, read on their own:
// the script runs as a database administrator who may not have the provider's
// key. Unset is the default; a value that is set but invalid is an error, so
// the table is never built (or dropped and rebuilt) for the wrong size.
export const readSearchEmbeddingsDimensions = ():
  { dimensions: number } | { error: string } => {
  const raw = process.env.ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS?.trim()
  if (!raw) return { dimensions: DEFAULT_SEARCH_EMBEDDINGS_DIMENSIONS }
  const parsed = Number(raw)
  return /^\d+$/.test(raw) &&
    Number.isSafeInteger(parsed) &&
    parsed >= MIN_SEARCH_EMBEDDINGS_DIMENSIONS &&
    parsed <= MAX_SEARCH_EMBEDDINGS_DIMENSIONS
    ? { dimensions: parsed }
    : {
        error: `ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS must be an integer between ${MIN_SEARCH_EMBEDDINGS_DIMENSIONS} and ${MAX_SEARCH_EMBEDDINGS_DIMENSIONS}, got "${raw}"`
      }
}

const parseEndpoint = (
  rawEndpoint: string,
  allowPrivateEndpoint: boolean
): string | null => {
  let parsed: URL
  try {
    parsed = new URL(rawEndpoint)
  } catch {
    return warnDisabled(
      'ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT must be a valid http(s) URL; semantic search will be disabled'
    )
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return warnDisabled(
      'ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT must be a valid http(s) URL; semantic search will be disabled'
    )
  }

  if (parsed.username || parsed.password) {
    return warnDisabled(
      'ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT must not include URL credentials; semantic search will be disabled'
    )
  }

  if (parsed.protocol === 'http:' && !allowPrivateEndpoint) {
    return warnDisabled(
      'ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT requires https unless ACTIVITIES_SEARCH_EMBEDDINGS_ALLOW_PRIVATE_ENDPOINT=true; semantic search will be disabled'
    )
  }

  return rawEndpoint.replace(/\/+$/, '')
}

const getOpenAIConfig = (
  dimensions: number,
  allowPrivateEndpoint: boolean
): OpenAISearchEmbeddingsConfig | null => {
  const rawEndpoint = process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT?.trim()
  const model = process.env.ACTIVITIES_SEARCH_EMBEDDINGS_MODEL?.trim()

  const missing: string[] = []
  if (!rawEndpoint) missing.push('ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT')
  if (!model) missing.push('ACTIVITIES_SEARCH_EMBEDDINGS_MODEL')
  if (missing.length > 0) {
    return warnDisabled(
      `ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER=openai requires ${missing.join(' and ')}; semantic search will be disabled`
    )
  }

  const endpoint = parseEndpoint(rawEndpoint as string, allowPrivateEndpoint)
  if (!endpoint) return null

  const apiKey = process.env.ACTIVITIES_SEARCH_EMBEDDINGS_API_KEY?.trim()

  return {
    provider: 'openai',
    endpoint,
    ...(apiKey ? { apiKey } : {}),
    model: model as string,
    dimensions,
    allowPrivateEndpoint
  }
}

const getGeminiConfig = (
  dimensions: number,
  allowPrivateEndpoint: boolean
): GeminiSearchEmbeddingsConfig | null => {
  const apiKey = process.env.ACTIVITIES_SEARCH_EMBEDDINGS_API_KEY?.trim()
  if (!apiKey) {
    return warnDisabled(
      'ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER=gemini requires ACTIVITIES_SEARCH_EMBEDDINGS_API_KEY; semantic search will be disabled'
    )
  }

  const rawEndpoint =
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ENDPOINT?.trim() ||
    DEFAULT_GEMINI_EMBEDDINGS_ENDPOINT
  const endpoint = parseEndpoint(rawEndpoint, allowPrivateEndpoint)
  if (!endpoint) return null

  const model =
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_MODEL?.trim() ||
    DEFAULT_GEMINI_EMBEDDINGS_MODEL

  return {
    provider: 'gemini',
    endpoint,
    apiKey,
    model,
    dimensions,
    allowPrivateEndpoint
  }
}

export const getSearchEmbeddingsConfig = (): {
  searchEmbeddings: SearchEmbeddingsConfig
} | null => {
  if (!matcher('ACTIVITIES_SEARCH_EMBEDDINGS_')) return null

  const provider = process.env.ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER?.trim()
  if (!provider) {
    return warnDisabled(
      'ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER is not set; semantic search will be disabled'
    )
  }

  if (provider !== 'openai' && provider !== 'gemini') {
    return warnDisabled(
      `Unknown ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER value "${provider}"; semantic search will be disabled`
    )
  }

  const allowPrivateEndpoint =
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_ALLOW_PRIVATE_ENDPOINT === 'true'
  const dimensions = parseDimensions()
  if (dimensions === null) return null

  if (provider === 'openai') {
    const config = getOpenAIConfig(dimensions, allowPrivateEndpoint)
    return config ? { searchEmbeddings: config } : null
  }

  const config = getGeminiConfig(dimensions, allowPrivateEndpoint)
  return config ? { searchEmbeddings: config } : null
}
