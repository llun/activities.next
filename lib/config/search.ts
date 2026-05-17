import { z } from 'zod'

const SearchBackend = z.enum(['database', 'meilisearch'])

export const SearchConfig = z.discriminatedUnion('backend', [
  z.object({
    backend: z.literal('database')
  }),
  z.object({
    backend: z.literal('meilisearch'),
    url: z.string().url(),
    apiKey: z.string().optional(),
    indexPrefix: z.string().min(1).default('activities_next'),
    timeoutMs: z.coerce.number().int().positive().default(2000)
  })
])
export type SearchConfig = z.infer<typeof SearchConfig>

export const getSearchConfig = (): { search: SearchConfig } => {
  const backend = SearchBackend.catch('database').parse(
    process.env.ACTIVITIES_SEARCH_BACKEND
  )

  if (backend === 'database') {
    return { search: { backend: 'database' } }
  }

  return {
    search: SearchConfig.parse({
      backend,
      url: process.env.ACTIVITIES_SEARCH_MEILISEARCH_URL,
      apiKey: process.env.ACTIVITIES_SEARCH_MEILISEARCH_API_KEY || undefined,
      indexPrefix:
        process.env.ACTIVITIES_SEARCH_MEILISEARCH_INDEX_PREFIX ||
        'activities_next',
      timeoutMs: process.env.ACTIVITIES_SEARCH_MEILISEARCH_TIMEOUT_MS ?? 2000
    })
  }
}
