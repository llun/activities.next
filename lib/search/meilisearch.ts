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
const TASK_POLL_INTERVAL_MS = 100
const configuredIndexPromises = new Map<string, Promise<void>>()

type MeilisearchTask = {
  uid?: unknown
  taskUid?: unknown
  status?: unknown
  error?: {
    message?: unknown
    code?: unknown
  } | null
}

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
  init: NonNullable<Parameters<typeof fetch>[1]>,
  timeoutMs = config.timeoutMs
) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    })
  } finally {
    clearTimeout(timeout)
  }
}

const sleep = (durationMs: number) =>
  new Promise((resolve) => setTimeout(resolve, durationMs))

const getMeilisearchTaskUid = async (
  response: Response,
  operationLabel: string
) => {
  const data = (await response.json()) as MeilisearchTask
  if (typeof data.taskUid !== 'number') {
    throw new Error(`Meilisearch ${operationLabel} did not return a taskUid`)
  }
  return data.taskUid
}

const getMeilisearchTaskError = (task: MeilisearchTask) => {
  if (!task.error) return ''

  const details = [
    typeof task.error.message === 'string' ? task.error.message : null,
    typeof task.error.code === 'string' ? task.error.code : null
  ].filter(Boolean)
  return details.length > 0 ? `: ${details.join(' ')}` : ''
}

const waitForMeilisearchTask = async ({
  config,
  taskUid,
  operationLabel
}: {
  config: Extract<SearchConfig, { backend: 'meilisearch' }>
  taskUid: number
  operationLabel: string
}) => {
  const deadline = Date.now() + config.timeoutMs

  for (;;) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      throw new Error(
        `Meilisearch ${operationLabel} task ${taskUid} timed out after ${config.timeoutMs}ms`
      )
    }

    const response = await fetchWithTimeout(
      config,
      getUrl(config, `/tasks/${taskUid}`),
      {
        method: 'GET',
        headers: getHeaders(config)
      },
      remainingMs
    )

    if (!response.ok) {
      throw new Error(
        `Meilisearch ${operationLabel} task ${taskUid} status check failed with status ${response.status}`
      )
    }

    const task = (await response.json()) as MeilisearchTask
    if (task.status === 'succeeded') return
    if (task.status === 'failed' || task.status === 'canceled') {
      throw new Error(
        `Meilisearch ${operationLabel} task ${taskUid} ${task.status}${getMeilisearchTaskError(task)}`
      )
    }
    if (task.status !== 'enqueued' && task.status !== 'processing') {
      throw new Error(
        `Meilisearch ${operationLabel} task ${taskUid} returned unknown status ${String(task.status)}`
      )
    }

    await sleep(
      Math.min(TASK_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()))
    )
  }
}

const waitForMeilisearchResponseTask = async (
  config: Extract<SearchConfig, { backend: 'meilisearch' }>,
  response: Response,
  operationLabel: string
) => {
  const taskUid = await getMeilisearchTaskUid(response, operationLabel)
  await waitForMeilisearchTask({ config, taskUid, operationLabel })
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
  if (createResponse.status !== EXISTING_INDEX_STATUS) {
    await waitForMeilisearchResponseTask(
      config,
      createResponse,
      'index configuration'
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
  await waitForMeilisearchResponseTask(
    config,
    settingsResponse,
    'settings update'
  )
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
  if (response.status !== 404) {
    await waitForMeilisearchResponseTask(config, response, 'document delete')
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
  await waitForMeilisearchResponseTask(config, response, 'document write')
}
