import type { Db } from '@/lib/database/kysely'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

export const createImportTestDatabase = async (): Promise<{
  database: Database
  db: Db
  actor: Actor
}> => {
  const created = createTestDatabase()
  const database = created.database
  await created.prepare()
  await database.migrate()
  await seedDatabase(database)

  // The seed leaves follows behind; every test sets up exactly what it needs.
  const seeded = await database.getFollowing({
    actorId: ACTOR1_ID,
    limit: 100
  })
  for (const follow of seeded) {
    await database.updateFollowStatus({
      followId: follow.id,
      status: 'Undo'
    })
  }

  const actor = (await database.getActorFromId({ id: ACTOR1_ID })) as Actor
  return { database, db: created.db, actor }
}

export const createRemoteActor = async (
  database: Database,
  name: string,
  domain = 'remote.test'
): Promise<Actor> => {
  const actorId = `https://${domain}/users/${name}`
  return (await database.createActor({
    actorId,
    username: name,
    domain,
    inboxUrl: `${actorId}/inbox`,
    sharedInboxUrl: `https://${domain}/inbox`,
    followersUrl: `${actorId}/followers`,
    publicKey: 'publicKey',
    createdAt: Date.now()
  })) as Actor
}

export const createPublicNote = async (
  database: Database,
  id: string,
  actorId: string,
  visibility: 'public' | 'direct' = 'public'
) => {
  await database.createNote({
    id,
    url: id,
    actorId,
    text: 'note',
    summary: '',
    to: visibility === 'public' ? [ACTIVITY_STREAM_PUBLIC] : [ACTOR1_ID + 'x'],
    cc: [],
    reply: '',
    createdAt: Date.now()
  })
}

// Stand-in for resolveAccountTarget: stored actors resolve, anything else is
// not found (the real one adds WebFinger, which the tests do not need).
export const resolveStoredAccount = async ({
  database,
  input
}: {
  database: Database
  input: string
}) => {
  const [username, domain] = input.split('@')
  const actor = await database.getActorFromUsername({ username, domain })
  return actor
    ? { type: 'resolved' as const, actor }
    : { type: 'not-found' as const }
}
