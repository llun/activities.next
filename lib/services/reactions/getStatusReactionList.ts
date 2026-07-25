import { Database } from '@/lib/database/types'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import { Mastodon } from '@/lib/types/activitypub'
import { Actor } from '@/lib/types/domain/actor'

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

  const [rollups, reactors] = await Promise.all([
    database.getStatusReactionRollups({
      statusIds: [statusId],
      currentActorId: currentActor?.id
    }),
    database.getStatusReactionActors({ statusId, ...(name ? { name } : {}) })
  ])

  const selected = name
    ? rollups.filter((rollup) => rollup.name === name)
    : rollups
  if (selected.length === 0) return []

  // One batched account lookup for the whole page rather than one per reaction.
  const accounts = await database.getMastodonActorsFromIds({
    ids: [...new Set(reactors.map((reactor) => reactor.actorId))]
  })
  const accountByUrl = new Map(
    accounts.map((account) => [account.url, account])
  )

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
      .map((reactor) => accountByUrl.get(reactor.actorId))
      .filter((account): account is Mastodon.Account => Boolean(account))
  }))
}
