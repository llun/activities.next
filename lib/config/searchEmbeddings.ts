import { z } from 'zod'

import { logger } from '@/lib/utils/logger'

import { matcher } from './utils'

export const DEFAULT_SEARCH_EMBEDDINGS_DIMENSIONS = 768
export const MIN_SEARCH_EMBEDDINGS_DIMENSIONS = 1
export const MAX_SEARCH_EMBEDDINGS_DIMENSIONS = 4000
export const DEFAULT_GEMINI_EMBEDDINGS_MODEL = 'gemini-embedding-001'
export const DEFAULT_GEMINI_EMBEDDINGS_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta'

// Request size and time limits, shared by every provider.
export const MIN_SEARCH_EMBEDDINGS_BATCH_SIZE = 1
export const MAX_SEARCH_EMBEDDINGS_BATCH_SIZE = 256
export const GEMINI_MAX_SEARCH_EMBEDDINGS_BATCH_SIZE = 100
export const DEFAULT_SEARCH_EMBEDDINGS_TIMEOUT_MS = 30_000
export const MIN_SEARCH_EMBEDDINGS_TIMEOUT_MS = 1_000
export const MAX_SEARCH_EMBEDDINGS_TIMEOUT_MS = 120_000

// How an OpenAI-compatible request asks for a vector size: OpenAI's
// `dimensions`, Mistral's `output_dimension`, or not at all (a model with a
// fixed size, such as mistral-embed's 1024, or a server that rejects the
// field). The answer's length is checked against the configured size either
// way.
export const SEARCH_EMBEDDINGS_DIMENSIONS_FIELDS = [
  'dimensions',
  'output_dimension',
  'none'
] as const
export type SearchEmbeddingsDimensionsField =
  (typeof SEARCH_EMBEDDINGS_DIMENSIONS_FIELDS)[number]

const limits = {
  dimensions: z
    .number()
    .int()
    .min(MIN_SEARCH_EMBEDDINGS_DIMENSIONS)
    .max(MAX_SEARCH_EMBEDDINGS_DIMENSIONS),
  batchSize: z
    .number()
    .int()
    .min(MIN_SEARCH_EMBEDDINGS_BATCH_SIZE)
    .max(MAX_SEARCH_EMBEDDINGS_BATCH_SIZE),
  timeoutMs: z
    .number()
    .int()
    .min(MIN_SEARCH_EMBEDDINGS_TIMEOUT_MS)
    .max(MAX_SEARCH_EMBEDDINGS_TIMEOUT_MS)
}

export const OpenAISearchEmbeddingsConfig = z.object({
  provider: z.literal('openai'),
  endpoint: z.string(),
  apiKey: z.string().optional(),
  model: z.string(),
  ...limits,
  dimensionsField: z.enum(SEARCH_EMBEDDINGS_DIMENSIONS_FIELDS),
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
  ...limits,
  // batchEmbedContents takes at most 100 requests.
  batchSize: limits.batchSize.max(GEMINI_MAX_SEARCH_EMBEDDINGS_BATCH_SIZE),
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

// Defaults for an OpenAI-compatible endpoint, by host. Mistral's
// /v1/embeddings takes `output_dimension` (mistral-embed answers 1024 always)
// and caps the tokens of one request, so it gets small batches (8 posts of at
// most 2,000 characters); OpenAI takes `dimensions`; anything else (a local
// server, vLLM, another provider) sends no size field and a middling batch.
const openAIDefaultsFor = (
  endpoint: string
): { dimensionsField: SearchEmbeddingsDimensionsField; batchSize: number } => {
  const host = new URL(endpoint).hostname.toLowerCase()
  if (host === 'api.mistral.ai')
    return { dimensionsField: 'none', batchSize: 8 }
  if (host === 'api.openai.com') {
    return { dimensionsField: 'dimensions', batchSize: 64 }
  }
  return { dimensionsField: 'none', batchSize: 32 }
}

// A whole number from `name` within [min, max], `fallback` when unset, or
// undefined (after one warning) when invalid.
const parseBoundedInteger = (
  name: string,
  { min, max, fallback }: { min: number; max: number; fallback: number }
): number | undefined => {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  if (
    /^\d+$/.test(raw) &&
    Number.isSafeInteger(parsed) &&
    parsed >= min &&
    parsed <= max
  ) {
    return parsed
  }
  warnDisabled(
    `${name} must be an integer between ${min} and ${max}; semantic search will be disabled`
  )
  return undefined
}

const parseDimensionsField = (
  fallback: SearchEmbeddingsDimensionsField
): SearchEmbeddingsDimensionsField | undefined => {
  const raw = process.env.ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS_FIELD?.trim()
  if (!raw) return fallback
  if (
    (SEARCH_EMBEDDINGS_DIMENSIONS_FIELDS as readonly string[]).includes(raw)
  ) {
    return raw as SearchEmbeddingsDimensionsField
  }
  warnDisabled(
    `ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS_FIELD must be one of ${SEARCH_EMBEDDINGS_DIMENSIONS_FIELDS.join(', ')}; semantic search will be disabled`
  )
  return undefined
}

const parseTimeoutMs = () =>
  parseBoundedInteger('ACTIVITIES_SEARCH_EMBEDDINGS_TIMEOUT_MS', {
    min: MIN_SEARCH_EMBEDDINGS_TIMEOUT_MS,
    max: MAX_SEARCH_EMBEDDINGS_TIMEOUT_MS,
    fallback: DEFAULT_SEARCH_EMBEDDINGS_TIMEOUT_MS
  })

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

  const defaults = openAIDefaultsFor(endpoint)
  const dimensionsField = parseDimensionsField(defaults.dimensionsField)
  const batchSize = parseBoundedInteger(
    'ACTIVITIES_SEARCH_EMBEDDINGS_BATCH_SIZE',
    {
      min: MIN_SEARCH_EMBEDDINGS_BATCH_SIZE,
      max: MAX_SEARCH_EMBEDDINGS_BATCH_SIZE,
      fallback: defaults.batchSize
    }
  )
  const timeoutMs = parseTimeoutMs()
  if (
    dimensionsField === undefined ||
    batchSize === undefined ||
    timeoutMs === undefined
  ) {
    return null
  }

  const apiKey = process.env.ACTIVITIES_SEARCH_EMBEDDINGS_API_KEY?.trim()

  return {
    provider: 'openai',
    endpoint,
    ...(apiKey ? { apiKey } : {}),
    model: model as string,
    dimensions,
    dimensionsField,
    batchSize,
    timeoutMs,
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
  const batchSize = parseBoundedInteger(
    'ACTIVITIES_SEARCH_EMBEDDINGS_BATCH_SIZE',
    {
      min: MIN_SEARCH_EMBEDDINGS_BATCH_SIZE,
      max: GEMINI_MAX_SEARCH_EMBEDDINGS_BATCH_SIZE,
      fallback: GEMINI_MAX_SEARCH_EMBEDDINGS_BATCH_SIZE
    }
  )
  const timeoutMs = parseTimeoutMs()
  if (batchSize === undefined || timeoutMs === undefined) return null

  return {
    provider: 'gemini',
    endpoint,
    apiKey,
    model,
    dimensions,
    batchSize,
    timeoutMs,
    allowPrivateEndpoint
  }
}

export const getSearchEmbeddingsConfig = (): {
  searchEmbeddings: SearchEmbeddingsConfig
} | null => {
  if (!matcher('ACTIVITIES_SEARCH_EMBEDDINGS_')) return null

  // Any OpenAI-compatible API (Mistral, OpenAI, Ollama, LM Studio, vLLM, …)
  // unless the native Gemini API is asked for.
  const provider =
    process.env.ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER?.trim() || 'openai'

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
