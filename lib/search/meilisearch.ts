import type { SearchConfig } from '@/lib/config/search'

export type MeilisearchType = 'accounts' | 'statuses' | 'hashtags'

export type MeilisearchDocument = {
  id: string
  entityId: string
  text: string
  entityType: MeilisearchType
  actorId?: string | null
  visibility?: string | null
  entityCreatedAt?: number | null
}

type SearchMeilisearchParams = {
  config: Extract<SearchConfig, { backend: 'meilisearch' }>
  type: MeilisearchType
  query: string
  limit: number
  offset: number
  filter?: string
}

type WriteMeilisearchDocumentsParams = {
  config: Extract<SearchConfig, { backend: 'meilisearch' }>
  type: MeilisearchType
  documents: MeilisearchDocument[]
}

const EXISTING_INDEX_STATUS = 409
const configuredIndexPromises = new Map<string, Promise<void>>()

const getIndexUid = (
  config: Extract<SearchConfig, { backend: 'meilisearch' }>,
  type: MeilisearchType
) => `${config.indexPrefix}_${type}`

const getConfiguredIndexCacheKey = (
  config: Extract<SearchConfig, { backend: 'meilisearch' }>,
  type: MeilisearchType
) => `${config.url}\0${getIndexUid(config, type)}`

const getUrl = (
  config: Extract<SearchConfig, { backend: 'meilisearch' }>,
  path: string
) => `${config.url.replace(/\/+$/, '')}${path}`

const getHeaders = (
  config: Extract<SearchConfig, { backend: 'meilisearch' }>
) =>
  ({
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
  }) as Record<string, string>

const fetchWithTimeout = async (
  config: Extract<SearchConfig, { backend: 'meilisearch' }>,
  input: string,
  init: NonNullable<Parameters<typeof fetch>[1]>
) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    })
  } finally {
    clearTimeout(timeout)
  }
}

export const searchMeilisearch = async ({
  config,
  type,
  query,
  limit,
  offset,
  filter
}: SearchMeilisearchParams): Promise<string[]> => {
  const response = await fetchWithTimeout(
    config,
    getUrl(config, `/indexes/${getIndexUid(config, type)}/search`),
    {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify({
        q: query,
        limit,
        offset,
        attributesToRetrieve: ['entityId'],
        ...(filter ? { filter } : {})
      })
    }
  )

  if (!response.ok) {
    throw new Error(`Meilisearch search failed with status ${response.status}`)
  }

  const data = (await response.json()) as {
    hits?: { entityId?: unknown }[]
  }
  return (data.hits ?? [])
    .map((hit) => hit.entityId)
    .filter((entityId): entityId is string => typeof entityId === 'string')
}

export const configureMeilisearchIndex = async ({
  config,
  type
}: Pick<WriteMeilisearchDocumentsParams, 'config' | 'type'>) => {
  const cacheKey = getConfiguredIndexCacheKey(config, type)
  const cachedConfiguration = configuredIndexPromises.get(cacheKey)
  if (cachedConfiguration) return cachedConfiguration

  const configuration = configureMeilisearchIndexWithoutCache({
    config,
    type
  }).catch((error) => {
    configuredIndexPromises.delete(cacheKey)
    throw error
  })
  configuredIndexPromises.set(cacheKey, configuration)
  return configuration
}

const configureMeilisearchIndexWithoutCache = async ({
  config,
  type
}: Pick<WriteMeilisearchDocumentsParams, 'config' | 'type'>) => {
  const indexUid = getIndexUid(config, type)
  const createResponse = await fetchWithTimeout(
    config,
    getUrl(config, '/indexes'),
    {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify({ uid: indexUid, primaryKey: 'id' })
    }
  )

  if (!createResponse.ok && createResponse.status !== EXISTING_INDEX_STATUS) {
    throw new Error(
      `Meilisearch index configuration failed with status ${createResponse.status}`
    )
  }

  const settingsResponse = await fetchWithTimeout(
    config,
    getUrl(config, `/indexes/${indexUid}/settings`),
    {
      method: 'PATCH',
      headers: getHeaders(config),
      body: JSON.stringify({
        searchableAttributes: ['text'],
        filterableAttributes: ['entityId', 'actorId', 'visibility'],
        sortableAttributes: ['entityCreatedAt']
      })
    }
  )

  if (!settingsResponse.ok) {
    throw new Error(
      `Meilisearch settings update failed with status ${settingsResponse.status}`
    )
  }
}

export const resetMeilisearchIndexConfigurationCacheForTests = () => {
  configuredIndexPromises.clear()
}

export const deleteMeilisearchDocuments = async ({
  config,
  type
}: Pick<WriteMeilisearchDocumentsParams, 'config' | 'type'>) => {
  const response = await fetchWithTimeout(
    config,
    getUrl(config, `/indexes/${getIndexUid(config, type)}/documents`),
    {
      method: 'DELETE',
      headers: getHeaders(config)
    }
  )

  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Meilisearch document delete failed with status ${response.status}`
    )
  }
}

export const writeMeilisearchDocuments = async ({
  config,
  type,
  documents
}: WriteMeilisearchDocumentsParams) => {
  if (documents.length === 0) return

  await configureMeilisearchIndex({ config, type })
  const response = await fetchWithTimeout(
    config,
    getUrl(config, `/indexes/${getIndexUid(config, type)}/documents`),
    {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify(documents)
    }
  )

  if (!response.ok) {
    throw new Error(
      `Meilisearch document write failed with status ${response.status}`
    )
  }
}
