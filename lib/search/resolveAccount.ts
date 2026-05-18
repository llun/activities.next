import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { getConfiguredHost } from '@/lib/config/configuredHost'
import { Database } from '@/lib/database/types'
import { normalizeAccountSearchQuery } from '@/lib/search/normalizeAccountSearchQuery'
import { logger } from '@/lib/utils/logger'

type ResolveAccountForSearchParams = {
  database: Database
  query: string
}

const parseAccountUrlQuery = (query: string) => {
  let url: URL
  try {
    url = new URL(query.trim())
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const [firstSegment, secondSegment] = url.pathname.split('/').filter(Boolean)
  const username = firstSegment?.startsWith('@')
    ? firstSegment.slice(1)
    : firstSegment === 'users'
      ? secondSegment
      : null
  if (!username || username.includes('@')) return null

  const domain = url.hostname
  if (!domain) return null

  return { username, domain, account: `${username}@${domain}` }
}

const parseAccountQuery = (query: string) => {
  const accountUrl = parseAccountUrlQuery(query)
  if (accountUrl) return accountUrl

  const cleanedQuery = normalizeAccountSearchQuery(query)
  if (!cleanedQuery) return null

  const parts = cleanedQuery.split('@')
  if (parts.length > 2) return null

  const [username, domain = getConfiguredHost()] = parts
  if (!username || !domain) return null

  return { username, domain, account: `${username}@${domain}` }
}

export const resolveAccountForSearch = async ({
  database,
  query
}: ResolveAccountForSearchParams): Promise<string | null> => {
  const parsed = parseAccountQuery(query)
  if (!parsed) return null

  const existingActor = await database.getActorFromUsername({
    username: parsed.username,
    domain: parsed.domain
  })
  if (existingActor) {
    await database.upsertActorSearchDocument({ actorId: existingActor.id })
    return existingActor.id
  }

  const trimmedQuery = query.trim()
  if (
    !trimmedQuery.includes('@') &&
    !trimmedQuery.startsWith('http://') &&
    !trimmedQuery.startsWith('https://')
  ) {
    return null
  }

  try {
    const actorId = await getWebfingerSelf({ account: parsed.account })
    if (!actorId) return null

    const actor = await recordActorIfNeeded({ actorId, database })
    if (!actor) return null

    await database.upsertActorSearchDocument({ actorId: actor.id })
    return actor.id
  } catch (error) {
    logger.warn({
      message: 'Failed to resolve account for search',
      account: parsed.account,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}
