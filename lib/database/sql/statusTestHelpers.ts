import { Database } from '@/lib/database/types'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

export const { actors, statuses } = DatabaseSeed
export const primaryActorId = actors.primary.id
export const replyAuthorId = actors.replyAuthor.id
export const pollAuthorId = actors.pollAuthor.id
export const extraActorId = actors.extra.id
export const emptyActorId = actors.empty.id

// Creates a throwaway actor on `database` so a test can own its data without
// touching the seeded actors. Returns the actor id.
export const createIsolatedActorFactory =
  (database: Database) =>
  async (suffix: string, { local = true }: { local?: boolean } = {}) => {
    const actorId = `https://${local ? actors.primary.domain : 'remote.test'}/users/${suffix}`
    await database.createActor({
      actorId,
      username: suffix,
      domain: local ? actors.primary.domain : 'remote.test',
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: `https://${local ? actors.primary.domain : 'remote.test'}/inbox`,
      publicKey: `public-key-${suffix}`,
      ...(local ? { privateKey: `private-key-${suffix}` } : {}),
      createdAt: Date.now()
    })
    return actorId
  }
