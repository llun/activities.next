import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { logger } from '@/lib/utils/logger'

type ResolveAccountForSearchParams = {
  database: Database
  query: string
}

const getConfiguredHost = () => {
  const host = getConfig().host
  return host.includes('://') ? new URL(host).host : host
}

const parseAccountQuery = (query: string) => {
  const cleanedQuery = query
    .trim()
    .replace(/^acct:/i, '')
    .replace(/^@/, '')
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

  if (!query.includes('@')) return null

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
