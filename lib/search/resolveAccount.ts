import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { Database } from '@/lib/database/types'
import { logger } from '@/lib/utils/logger'

import { parseAccountSearchQuery } from './parseAccountSearchQuery'

type ResolveAccountForSearchParams = {
  database: Database
  query: string
}

export const resolveAccountForSearch = async ({
  database,
  query
}: ResolveAccountForSearchParams): Promise<string | null> => {
  const parsed = parseAccountSearchQuery(query)
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
