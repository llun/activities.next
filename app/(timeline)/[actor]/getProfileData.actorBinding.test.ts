import { enableFetchMocks } from 'jest-fetch-mock'
import knex from 'knex'

import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { serveFederationRoutes } from '@/lib/stub/serveFederationRoutes'
import { Actor } from '@/lib/types/domain/actor'

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
  getFederationSigningActorSafe: vi.fn(async () => undefined)
}))
// `signedHeaders` needs a real RSA key; a stand-in that stamps a `signature`
// header lets the fetch mock tell a signed request from an unsigned one.
vi.mock('@/lib/utils/signature', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/signature')>()),
  signedHeaders: () => ({ signature: 'signed' })
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

const serve = serveFederationRoutes

describe('getProfileData persists only a document served by its own id', () => {
  let sql: ReturnType<typeof knex>
  let database: Database

  beforeEach(async () => {
    vi.mocked(getFederationSigningActorSafe).mockReset()
    vi.mocked(getFederationSigningActorSafe).mockResolvedValue(undefined)
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
  const victimWebfinger = { 'alice@victim.test': victimId }
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
    serve(
      { [victimId]: actorDocument(victimId, 'victim-key') },
      { webfinger: victimWebfinger }
    )
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
    serve(
      {
        [uploadId]: attackerDocument,
        [victimId]: actorDocument(victimId, 'victim-key')
      },
      { webfinger: victimWebfinger }
    )

    await renderProfile('@x@evil.test', uploadId)

    const stored = await database.getActorFromId({ id: victimId })
    expect(stored?.publicKey).toBe('victim-key')
    expect(stored?.inboxUrl).toBe(`${victimId}/inbox`)
    // The collection sizes come from the alias document's collections, which
    // the attacker controls, so they are written only for a document that was
    // itself persisted (fetched from its own id) — not on this create path.
    await expect(
      database.hasActorCounters({ actorId: victimId })
    ).resolves.toBe(false)
  })

  // The canonical re-fetch must carry the federation signer: an
  // authorized-fetch origin answers 401 to an unsigned one, which would leave
  // every alias-reached actor from such a server unrecorded.
  it('signs the canonical re-fetch behind an alias', async () => {
    vi.mocked(getFederationSigningActorSafe).mockResolvedValue({
      id: 'https://local.test/users/__instance__'
    } as unknown as Actor)
    serve(
      {
        [uploadId]: attackerDocument,
        [victimId]: actorDocument(victimId, 'victim-key')
      },
      { signedOnly: true, webfinger: victimWebfinger }
    )

    await renderProfile('@x@evil.test', uploadId)

    await expect(
      database.getActorFromId({ id: victimId })
    ).resolves.toMatchObject({ publicKey: 'victim-key' })
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
    ['an ordinary', '@alice@victim.test', victimId, 'alice@victim.test'],
    [
      'a split-domain',
      '@llun@llun.test',
      'https://social.llun.test/users/llun',
      'llun@social.llun.test'
    ]
  ])(
    'persists and refreshes %s profile fetched from its own id',
    async (_label, handle, actorId, actorHostAccount) => {
      serve(
        { [actorId]: actorDocument(actorId, 'first-key') },
        {
          webfinger: {
            [actorHostAccount]: {
              self: [actorId],
              subject: `acct:${handle.slice(1)}`
            }
          }
        }
      )
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

  // The handle's own WebFinger is not evidence for a handle on another host:
  // `@x@evil.test` can name any URL as `self`, including a same-origin upload
  // that names itself `admin` on victim.test. The page renders what it got,
  // but a row is created only once victim.test confirms the handle.
  it('renders but does not record an actor whose host does not confirm its handle', async () => {
    const forgedId = 'https://victim.test/media/forged.json'
    serve(
      {
        [forgedId]: actorDocument(forgedId, 'attacker-key', {
          preferredUsername: 'admin'
        })
      },
      { webfinger: { 'admin@victim.test': 'https://victim.test/users/admin' } }
    )

    const result = await renderProfile('@x@evil.test', forgedId)

    expect(result?.person.id).toBe(forgedId)
    await expect(database.getActorFromId({ id: forgedId })).resolves.toBeNull()
    await expect(
      database.getActorFromUsername({
        username: 'admin',
        domain: 'victim.test'
      })
    ).resolves.toBeNull()
    await expect(
      database.hasActorCounters({ actorId: forgedId })
    ).resolves.toBe(false)
  })

  // The same upload naming evil.test as its FEP-2c59 handle is confirmed by
  // evil.test, so it is recorded, but as `x@evil.test`, the handle that was
  // confirmed, never under a username on victim.test.
  it('records an actor its handle domain confirms under that domain', async () => {
    const forgedId = 'https://victim.test/media/forged.json'
    serve(
      {
        [forgedId]: actorDocument(forgedId, 'attacker-key', {
          preferredUsername: 'admin',
          webfinger: 'x@evil.test'
        })
      },
      { webfinger: { 'x@evil.test': forgedId } }
    )

    await renderProfile('@x@evil.test', forgedId)

    await expect(
      database.getActorFromId({ id: forgedId })
    ).resolves.toMatchObject({ username: 'x', domain: 'evil.test' })
    await expect(
      database.getActorFromUsername({
        username: 'admin',
        domain: 'victim.test'
      })
    ).resolves.toBeNull()
  })
})
