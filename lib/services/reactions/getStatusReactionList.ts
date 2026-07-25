import { Database } from '@/lib/database/types'
import { normalizeStoredReactionName } from '@/lib/services/reactions/reactionName'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import { Mastodon } from '@/lib/types/activitypub'
import { Actor } from '@/lib/types/domain/actor'
import { idToUrl } from '@/lib/utils/urlToId'

// The Pleroma/Akkoma `GET .../reactions` entry: the rollup a Status already
// carries, plus the accounts behind it. Not core Mastodon API.
export interface StatusReactionWithAccounts {
  name: string
  count: number
  me: boolean
  url: string | null
  static_url: string | null
  accounts: Mastodon.Account[]
}

export const getStatusReactionList = async ({
  database,
  currentActor,
  statusId,
  name
}: {
  database: Database
  currentActor: Actor | null
  statusId: string
  name?: string
}): Promise<StatusReactionWithAccounts[] | null> => {
  const status = await getReadableStatus({
    database,
    statusId,
    currentActor,
    withReplies: false
  })
  if (!status) return null

  // The `:emoji` URL segment is free text, and the write path stores a custom
  // emoji colon-free — so normalise identically here or `GET .../reactions/:x:`
  // would find nothing that `PUT .../reactions/:x:` had just created.
  const storedName = name ? normalizeStoredReactionName(name) : undefined

  const [rollups, reactors] = await Promise.all([
    database.getStatusReactionRollups({
      statusIds: [statusId],
      currentActorId: currentActor?.id
    }),
    database.getStatusReactionActors({
      statusId,
      ...(storedName ? { name: storedName } : {})
    })
  ])

  const selected = storedName
    ? rollups.filter((rollup) => rollup.name === storedName)
    : rollups
  if (selected.length === 0) return []

  // One batched account lookup for the whole page rather than one per reaction.
  const requestedActorIds = [...new Set(reactors.map((r) => r.actorId))]
  const requestedActorIdSet = new Set(requestedActorIds)
  const accounts = await database.getMastodonActorsFromIds({
    ids: requestedActorIds
  })
  // Key by the actor URI decoded from the opaque `account.id`, falling back to
  // `account.url` — for some actors `url` is a profile URL (`/@name`) rather
  // than the actor URI, and keying on it alone drops them. Mirrors how
  // getMastodonStatuses builds its account cache.
  const accountByActorId = new Map<string, Mastodon.Account>()
  for (const account of accounts) {
    const decodedActorId =
      typeof account.id === 'string' ? idToUrl(account.id) : ''
    if (requestedActorIdSet.has(decodedActorId)) {
      accountByActorId.set(decodedActorId, account)
      continue
    }
    if (requestedActorIdSet.has(account.url)) {
      accountByActorId.set(account.url, account)
    }
  }

  return selected.map((rollup) => ({
    name: rollup.name,
    count: rollup.count,
    me: rollup.me,
    url: rollup.url,
    static_url: rollup.staticUrl,
    // Reactors are returned oldest-first, matching the rollup ordering. An
    // actor we can no longer resolve is dropped rather than nulled.
    accounts: reactors
      .filter((reactor) => reactor.name === rollup.name)
      .map((reactor) => accountByActorId.get(reactor.actorId))
      .filter((account): account is Mastodon.Account => Boolean(account))
  }))
}
