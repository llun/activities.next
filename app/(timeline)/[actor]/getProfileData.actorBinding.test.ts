import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import knex from 'knex'

import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import { MockActivityPubPerson } from '@/lib/stub/person'

import { getProfileData } from './getProfileData'

enableFetchMocks()

// The real `getActorPerson` and a real database run here (only the network,
// WebFinger and the outbox/collection readers are mocked): the hole is in what
// the profile page writes from the document its WebFinger `self` link serves.
vi.mock('@/lib/activities/getWebfingerSelf')
vi.mock('@/lib/activities/getActorPosts', () => ({
  getActorPosts: async () => ({ statuses: [], statusesCount: null })
}))
vi.mock('@/lib/activities/getActorCollectionCounts', () => ({
  getActorCollectionCounts: async () => ({
    followersCount: 7,
    followingCount: 3,
    statusesCount: 11
  })
}))
vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: async () => true
}))
vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActorSafe: async () => null
}))
vi.mock('@/lib/services/federation/serverSoftware', () => ({
  isPixelfedActor: async () => false,
  isPeerTubeActor: async () => false,
  getServerSoftwareInfo: async () => null
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

describe('getProfileData persists only a document served by its own id', () => {
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
  // A same-origin URL the attacker controls the body of (a user upload).
  const uploadId = 'https://victim.test/media/upload.json'
  const attackerDocument = actorDocument(victimId, 'attacker-key', {
    inbox: 'https://victim.test/media/attacker-inbox',
    endpoints: { sharedInbox: 'https://victim.test/media/attacker-inbox' }
  })

  const renderProfile = (handle: string, selfId: string) => {
    vi.mocked(getWebfingerSelf).mockResolvedValue(selfId)
    return getProfileData(database, handle, true, { currentActor: null })
  }

  // Regression: WebFinger for @x@evil.test names the upload as `self`, the
  // upload claims alice's id with the attacker's key and inbox, and the page
  // overwrote alice's existing row with them — after which that key verified
  // activities signed as alice and her DMs went to the attacker's inbox.
  it('never rewrites an existing row from a document an alias served', async () => {
    serve({ [victimId]: actorDocument(victimId, 'victim-key') })
    await renderProfile('@alice@victim.test', victimId)
    const before = await database.getActorFromId({ id: victimId })
    expect(before).toMatchObject({ publicKey: 'victim-key' })
    serve({
      [uploadId]: attackerDocument,
      [victimId]: actorDocument(victimId, 'victim-key')
    })

    const result = await renderProfile('@x@evil.test', uploadId)

    // The page still renders what was fetched; only the write is refused.
    expect(result?.person.id).toBe(victimId)
    const after = await database.getActorFromId({ id: victimId })
    expect(after?.publicKey).toBe('victim-key')
    expect(after?.inboxUrl).toBe(before?.inboxUrl)
    expect(after?.sharedInboxUrl).toBe(before?.sharedInboxUrl)
    await expect(database.getActorFromId({ id: uploadId })).resolves.toBeNull()
  })

  it('creates a new row from what the canonical id serves, not the alias document', async () => {
    serve({
      [uploadId]: attackerDocument,
      [victimId]: actorDocument(victimId, 'victim-key')
    })

    await renderProfile('@x@evil.test', uploadId)

    const stored = await database.getActorFromId({ id: victimId })
    expect(stored?.publicKey).toBe('victim-key')
    expect(stored?.inboxUrl).toBe(`${victimId}/inbox`)
  })

  it('records nothing when the canonical id does not serve itself', async () => {
    serve({ [uploadId]: attackerDocument })

    const result = await renderProfile('@x@evil.test', uploadId)

    expect(result?.person.id).toBe(victimId)
    await expect(database.getActorFromId({ id: victimId })).resolves.toBeNull()
  })

  // The other side of the guard: an ordinary profile and a split-domain one
  // (handle on llun.test, id on social.llun.test) both have WebFinger name the
  // actor id itself, so they persist and refresh as before.
  it.each([
    ['an ordinary', '@alice@victim.test', victimId],
    ['a split-domain', '@llun@llun.test', 'https://social.llun.test/users/llun']
  ])(
    'persists and refreshes %s profile fetched from its own id',
    async (_label, handle, actorId) => {
      serve({ [actorId]: actorDocument(actorId, 'first-key') })
      await renderProfile(handle, actorId)
      await expect(
        database.getActorFromId({ id: actorId })
      ).resolves.toMatchObject({ publicKey: 'first-key' })

      serve({ [actorId]: actorDocument(actorId, 'rotated-key') })
      await renderProfile(handle, actorId)

      await expect(
        database.getActorFromId({ id: actorId })
      ).resolves.toMatchObject({ publicKey: 'rotated-key' })
    }
  )
})
