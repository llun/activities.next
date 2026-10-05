import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import { MockActivityPubPerson } from '@/lib/stub/person'

import { recordActorIfNeeded } from './utils'

enableFetchMocks()

// The real `getActorPerson` runs here (only the network is mocked): the hole
// is in how `recordActorIfNeeded` combines the id it was asked for with the
// document `getActorPerson` legitimately returns for it.
vi.mock('@/lib/activities/getActorCollectionCounts', () => ({
  getActorCollectionCounts: async () => ({
    followersCount: null,
    followingCount: null,
    statusesCount: null
  })
}))

const actorDocument = (
  id: string,
  publicKeyPem: string,
  overrides: Record<string, unknown> = {}
) =>
  JSON.stringify({
    ...MockActivityPubPerson({ id }),
    publicKey: { id: `${id}#main-key`, owner: id, publicKeyPem },
    ...overrides
  })

const serve = (routes: Record<string, string>) => {
  fetchMock.resetMocks()
  fetchMock.mockResponse(async (req) => {
    const body = routes[req.url]
    if (!body) return { status: 404, body: 'Not Found' }
    return { status: 200, body }
  })
}

describe('recordActorIfNeeded binds the row id to the fetched actor', () => {
  let sql: ReturnType<typeof knex>
  let database: Database

  beforeEach(async () => {
    sql = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    database = getSQLDatabase(sql)
    await database.migrate()
  })

  afterEach(async () => {
    await database.destroy()
  })

  const victimId = 'https://victim.test/users/alice'
  const attackerId = 'https://evil.test/users/x'

  // Regression (F004): `getActorPerson(evil)` re-fetches the id evil's
  // document claims and returns VICTIM's real document, as it should. The row
  // used to be written with id = evil but username/domain = victim's, so the
  // handle @alice@victim.test resolved to a row that every later refresh
  // re-fetches from evil.test — which can then serve its own inbox and key.
  it('refuses an actor whose fetched id is on another origin', async () => {
    serve({
      [attackerId]: actorDocument(victimId, 'victim-key'),
      [victimId]: actorDocument(victimId, 'victim-key')
    })

    const actor = await recordActorIfNeeded({ actorId: attackerId, database })

    expect(actor).toBeUndefined()
    await expect(
      database.getActorFromId({ id: attackerId })
    ).resolves.toBeNull()
    await expect(
      database.getActorFromUsername({
        username: 'alice',
        domain: 'victim.test'
      })
    ).resolves.toBeNull()
  })

  it('does not let a stale refresh rewrite a row from another origin', async () => {
    const oldTime = new Date(Date.now() - 4 * 86_400_000)
    await database.createActor({
      actorId: attackerId,
      type: 'Person',
      username: 'x',
      domain: 'evil.test',
      followersUrl: `${attackerId}/followers`,
      inboxUrl: `${attackerId}/inbox`,
      sharedInboxUrl: 'https://evil.test/inbox',
      publicKey: 'evil-key',
      createdAt: oldTime.getTime()
    })
    await sql('actors').where('id', attackerId).update({ updatedAt: oldTime })
    serve({
      [attackerId]: actorDocument(victimId, 'victim-key'),
      [victimId]: actorDocument(victimId, 'victim-key')
    })

    await expect(
      recordActorIfNeeded({ actorId: attackerId, database })
    ).resolves.toBeUndefined()
    await expect(
      database.getActorFromId({ id: attackerId })
    ).resolves.toMatchObject({ publicKey: 'evil-key' })
  })

  // The other side of the guard: a split-domain deployment's WebFinger
  // `self` (on llun.test) names the actor on social.llun.test, and that id is
  // what gets recorded — requested and fetched id are the same actor.
  it('records a split-domain actor by the id its WebFinger self link names', async () => {
    const actorId = 'https://social.llun.test/users/llun'
    serve({ [actorId]: actorDocument(actorId, 'llun-key') })

    const actor = await recordActorIfNeeded({ actorId, database })

    expect(actor).toMatchObject({
      id: actorId,
      username: 'llun',
      domain: 'social.llun.test',
      publicKey: 'llun-key'
    })
  })

  // A server may canonicalise within its own origin (Mastodon serves the
  // actor for /@bob with id /users/bob), so an exact id match is too strict.
  it('records an actor whose fetched id is a same-origin canonical form', async () => {
    const requestedId = 'https://remote.test/@bob'
    const canonicalId = 'https://remote.test/users/bob'
    serve({ [requestedId]: actorDocument(canonicalId, 'bob-key') })

    const actor = await recordActorIfNeeded({ actorId: requestedId, database })

    expect(actor).toMatchObject({
      id: requestedId,
      username: 'bob',
      domain: 'remote.test'
    })
  })
})
