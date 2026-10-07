import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { serveFederationRoutes } from '@/lib/stub/serveFederationRoutes'
import { Actor } from '@/lib/types/domain/actor'

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

vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi.fn(async () => undefined)
}))
// `signedHeaders` needs a real RSA key; a stand-in that stamps a `signature`
// header lets the fetch mock tell a signed request from an unsigned one.
vi.mock('@/lib/utils/signature', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/signature')>()),
  signedHeaders: () => ({ signature: 'signed' })
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

describe('recordActorIfNeeded binds the row id to the fetched actor', () => {
  let sql: ReturnType<typeof knex>
  let database: Database

  beforeEach(async () => {
    vi.mocked(getFederationSigningActor).mockReset()
    vi.mocked(getFederationSigningActor).mockResolvedValue(undefined)
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
  const victimWebfinger = { 'alice@victim.test': victimId }

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
  // what gets recorded — requested and fetched id are the same actor. The
  // actor host answers WebFinger for its own host too, with the handle's
  // domain as the subject (Mastodon's WEB_DOMAIN, GoToSocial's host).
  it('records a split-domain actor by the id its WebFinger self link names', async () => {
    const actorId = 'https://social.llun.test/users/llun'
    serve(
      { [actorId]: actorDocument(actorId, 'llun-key') },
      {
        webfinger: {
          'llun@social.llun.test': {
            self: [actorId],
            subject: 'acct:llun@llun.test'
          }
        }
      }
    )

    const actor = await recordActorIfNeeded({ actorId, database })

    expect(actor).toMatchObject({
      id: actorId,
      username: 'llun',
      domain: 'social.llun.test',
      publicKey: 'llun-key'
    })
  })

  // A server may canonicalise within its own origin (Mastodon serves the
  // actor for /@bob with id /users/bob), so an exact id match is too strict —
  // but the row is keyed on the id the origin names, not on the alias.
  it('records an actor whose fetched id is a same-origin canonical form under that id', async () => {
    const requestedId = 'https://remote.test/@bob'
    const canonicalId = 'https://remote.test/users/bob'
    serve(
      {
        [requestedId]: actorDocument(canonicalId, 'bob-key'),
        [canonicalId]: actorDocument(canonicalId, 'bob-key')
      },
      { webfinger: { 'bob@remote.test': canonicalId } }
    )

    const actor = await recordActorIfNeeded({ actorId: requestedId, database })

    expect(actor).toMatchObject({
      id: canonicalId,
      username: 'bob',
      domain: 'remote.test'
    })
    await expect(
      database.getActorFromId({ id: requestedId })
    ).resolves.toBeNull()
    // Counters are keyed on the stored row, the key hasActorCounters reads.
    await expect(
      database.hasActorCounters({ actorId: canonicalId })
    ).resolves.toBe(true)
    await expect(
      database.hasActorCounters({ actorId: requestedId })
    ).resolves.toBe(false)
  })

  // Regression: the alias's document was persisted under the id it claims.
  // Any same-origin URL (a user upload) could serve JSON naming the real id
  // with its own key and inbox, and that key then verified activities signed
  // as the real actor. Only the canonical id's own document is stored.
  it('stores the key the canonical id serves, not the one an alias document claims', async () => {
    const uploadId = 'https://victim.test/media/upload.json'
    serve(
      {
        [uploadId]: actorDocument(victimId, 'attacker-key', {
          inbox: 'https://victim.test/media/attacker-inbox'
        }),
        [victimId]: actorDocument(victimId, 'victim-key')
      },
      { webfinger: victimWebfinger }
    )

    const actor = await recordActorIfNeeded({ actorId: uploadId, database })

    expect(actor).toMatchObject({ id: victimId, publicKey: 'victim-key' })
    const stored = await database.getActorFromId({ id: victimId })
    expect(stored?.publicKey).toBe('victim-key')
    expect(stored?.inboxUrl).toBe(`${victimId}/inbox`)
  })

  // The canonical re-fetch must carry the federation signer: an
  // authorized-fetch origin answers 401 to an unsigned one, which would leave
  // every alias-reached actor from such a server unrecorded.
  it('signs the canonical re-fetch behind an alias', async () => {
    vi.mocked(getFederationSigningActor).mockResolvedValue({
      id: 'https://local.test/users/__instance__'
    } as unknown as Actor)
    const uploadId = 'https://victim.test/media/upload.json'
    serve(
      {
        [uploadId]: actorDocument(victimId, 'attacker-key'),
        [victimId]: actorDocument(victimId, 'victim-key')
      },
      { signedOnly: true, webfinger: victimWebfinger }
    )

    const actor = await recordActorIfNeeded({ actorId: uploadId, database })

    expect(actor).toMatchObject({ id: victimId, publicKey: 'victim-key' })
  })

  it('refuses an alias whose canonical id cannot be fetched', async () => {
    const uploadId = 'https://victim.test/media/upload.json'
    serve({ [uploadId]: actorDocument(victimId, 'attacker-key') })

    await expect(
      recordActorIfNeeded({ actorId: uploadId, database })
    ).resolves.toBeUndefined()
    await expect(database.getActorFromId({ id: victimId })).resolves.toBeNull()
    await expect(database.getActorFromId({ id: uploadId })).resolves.toBeNull()
  })

  it('refuses an alias whose canonical id names yet another id', async () => {
    const uploadId = 'https://victim.test/media/upload.json'
    const otherId = 'https://victim.test/users/mallory'
    serve({
      [uploadId]: actorDocument(victimId, 'attacker-key'),
      [victimId]: actorDocument(otherId, 'other-key')
    })

    await expect(
      recordActorIfNeeded({ actorId: uploadId, database })
    ).resolves.toBeUndefined()
    await expect(database.getActorFromId({ id: victimId })).resolves.toBeNull()
    await expect(database.getActorFromId({ id: otherId })).resolves.toBeNull()
  })

  // Neither branch may write an alias-served key onto an existing canonical
  // row: the alias is answered with the stored row as-is, even a stale one.
  it('never rewrites a stored canonical row from an alias document', async () => {
    const oldTime = new Date(Date.now() - 4 * 86_400_000)
    serve(
      { [victimId]: actorDocument(victimId, 'victim-key') },
      { webfinger: victimWebfinger }
    )
    await recordActorIfNeeded({ actorId: victimId, database })
    await sql('actors').where('id', victimId).update({ updatedAt: oldTime })
    const uploadId = 'https://victim.test/media/upload.json'
    serve({
      [uploadId]: actorDocument(victimId, 'attacker-key'),
      [victimId]: actorDocument(victimId, 'victim-key')
    })

    const actor = await recordActorIfNeeded({ actorId: uploadId, database })

    expect(actor?.id).toBe(victimId)
    await expect(
      database.getActorFromId({ id: victimId })
    ).resolves.toMatchObject({ publicKey: 'victim-key' })
    await expect(database.getActorFromId({ id: uploadId })).resolves.toBeNull()
  })

  // Regression: an alias used to be written as the row id while holding the
  // actor's UNIQUE (username, domain), so recording the real id afterwards
  // failed on the constraint and every activity from the actor threw.
  it('lets the real id record after a same-origin alias was recorded', async () => {
    const aliasId = `${victimId}?squat`
    serve(
      {
        [aliasId]: actorDocument(victimId, 'victim-key'),
        [victimId]: actorDocument(victimId, 'victim-key')
      },
      { webfinger: victimWebfinger }
    )

    const viaAlias = await recordActorIfNeeded({ actorId: aliasId, database })
    const viaId = await recordActorIfNeeded({ actorId: victimId, database })

    expect(viaAlias?.id).toBe(victimId)
    expect(viaId?.id).toBe(victimId)
    await expect(
      sql('actors').where({ username: 'alice', domain: 'victim.test' })
    ).resolves.toHaveLength(1)
  })

  it('answers an alias with the row already stored under the fetched id', async () => {
    serve(
      { [victimId]: actorDocument(victimId, 'victim-key') },
      { webfinger: victimWebfinger }
    )
    await recordActorIfNeeded({ actorId: victimId, database })
    const aliasId = 'https://victim.test/@alice'
    serve({ [aliasId]: actorDocument(victimId, 'victim-key') })

    const actor = await recordActorIfNeeded({ actorId: aliasId, database })

    expect(actor?.id).toBe(victimId)
    await expect(database.getActorFromId({ id: aliasId })).resolves.toBeNull()
  })

  // A row written under an alias before the fix still holds the handle. It is
  // not re-keyed; recording the real id refuses instead of throwing.
  it('refuses, without throwing, a real id whose handle a legacy alias row holds', async () => {
    const aliasId = `${victimId}?squat`
    await database.createActor({
      actorId: aliasId,
      type: 'Person',
      username: 'alice',
      domain: 'victim.test',
      followersUrl: `${victimId}/followers`,
      inboxUrl: `${victimId}/inbox`,
      sharedInboxUrl: 'https://victim.test/inbox',
      publicKey: 'victim-key',
      createdAt: Date.now()
    })
    serve({ [victimId]: actorDocument(victimId, 'victim-key') })

    await expect(
      recordActorIfNeeded({ actorId: victimId, database })
    ).resolves.toBeUndefined()
    await expect(database.getActorFromId({ id: victimId })).resolves.toBeNull()
  })

  // Counters are keyed on the row id `hasActorCounters` reads. Keyed on the
  // fetched id instead, a legacy alias row never looked synced and every call
  // made a blocking remote fetch.
  it('marks a legacy alias row synced so later calls do not refetch', async () => {
    const aliasId = 'https://victim.test/@alice'
    await database.createActor({
      actorId: aliasId,
      type: 'Person',
      username: 'alice',
      domain: 'victim.test',
      followersUrl: `${victimId}/followers`,
      inboxUrl: `${victimId}/inbox`,
      sharedInboxUrl: 'https://victim.test/inbox',
      publicKey: 'victim-key',
      createdAt: Date.now()
    })
    serve({ [aliasId]: actorDocument(victimId, 'victim-key') })

    await recordActorIfNeeded({ actorId: aliasId, database })
    const fetchesAfterFirstCall = fetchMock.mock.calls.length
    const actor = await recordActorIfNeeded({ actorId: aliasId, database })

    expect(fetchesAfterFirstCall).toBeGreaterThan(0)
    expect(fetchMock.mock.calls).toHaveLength(fetchesAfterFirstCall)
    expect(actor?.id).toBe(aliasId)
  })
})

// The origin check above proves only that one host vouches for a document, not
// that the handle it claims is genuine: any URL on the host can serve JSON
// naming itself with any `preferredUsername` there. A JSON upload on a
// Pleroma/Akkoma media path is the concrete case — it would mint
// `@admin@victim.test` with the uploader's key and inbox, and that key then
// verifies inbox traffic. Two gates close it, each bracketed on both sides.
describe('recordActorIfNeeded refuses a handle its host does not vouch for', () => {
  let sql: ReturnType<typeof knex>
  let database: Database

  beforeEach(async () => {
    vi.mocked(getFederationSigningActor).mockReset()
    vi.mocked(getFederationSigningActor).mockResolvedValue(undefined)
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

  const adminId = 'https://victim.test/users/admin'
  const uploadId = 'https://victim.test/media/forged.json'
  const forgedDocument = actorDocument(uploadId, 'attacker-key', {
    preferredUsername: 'admin',
    inbox: 'https://evil.test/inbox'
  })

  const expectNoForgedActor = async () => {
    await expect(database.getActorFromId({ id: uploadId })).resolves.toBeNull()
    await expect(
      database.getActorFromUsername({
        username: 'admin',
        domain: 'victim.test'
      })
    ).resolves.toBeNull()
  }

  // Even mislabelled as ActivityPub, the upload is not who the host's
  // WebFinger says `admin@victim.test` is.
  it('refuses an upload whose claimed handle WebFinger resolves to another actor', async () => {
    serve(
      { [uploadId]: forgedDocument },
      { webfinger: { 'admin@victim.test': adminId } }
    )

    await expect(
      recordActorIfNeeded({ actorId: uploadId, database })
    ).resolves.toBeUndefined()
    await expectNoForgedActor()
  })

  it('refuses an actor whose host has no WebFinger answer for its handle', async () => {
    serve({ [uploadId]: forgedDocument })

    await expect(
      recordActorIfNeeded({ actorId: uploadId, database })
    ).resolves.toBeUndefined()
    await expectNoForgedActor()
  })

  // The handle is confirmed against the host the row is stored under, never
  // against a domain the document or the requester chose.
  it('asks the actor host, not another domain, to confirm the handle', async () => {
    serve(
      { [uploadId]: forgedDocument },
      { webfinger: { 'admin@evil.test': uploadId } }
    )

    await expect(
      recordActorIfNeeded({ actorId: uploadId, database })
    ).resolves.toBeUndefined()
    await expectNoForgedActor()
  })

  // FEP-2c59, as Mastodon follows it: another domain may confirm an actor
  // its host does not answer for, but only under that domain's name. The
  // stored handle is the one that was confirmed, so a document claiming
  // `admin` on the actor host can never become `admin@victim.test` this way.
  it('records an actor confirmed only by its webfinger domain under that domain', async () => {
    serve(
      {
        [uploadId]: actorDocument(uploadId, 'attacker-key', {
          preferredUsername: 'admin',
          webfinger: 'admin@evil.test'
        })
      },
      { webfinger: { 'admin@evil.test': uploadId } }
    )

    await expect(
      recordActorIfNeeded({ actorId: uploadId, database })
    ).resolves.toMatchObject({
      id: uploadId,
      username: 'admin',
      domain: 'evil.test'
    })
    await expect(
      database.getActorFromUsername({
        username: 'admin',
        domain: 'victim.test'
      })
    ).resolves.toBeNull()
  })

  // Mastodon's `subject` redirect is the actor host's own answer, and the row
  // is stored under the handle the redirected domain confirmed.
  it('follows the subject the actor host answers with to the handle domain', async () => {
    const actorId = 'https://ap.remote.test/users/1234'
    serve(
      {
        [actorId]: actorDocument(actorId, 'alice-key', {
          preferredUsername: 'alice'
        })
      },
      {
        webfinger: {
          'alice@ap.remote.test': {
            self: [],
            subject: 'acct:alice@remote.test'
          },
          'alice@remote.test': actorId
        }
      }
    )

    await expect(
      recordActorIfNeeded({ actorId, database })
    ).resolves.toMatchObject({
      id: actorId,
      username: 'alice',
      domain: 'remote.test'
    })
  })

  it('records an actor whose host WebFinger names exactly its id', async () => {
    serve(
      { [adminId]: actorDocument(adminId, 'admin-key') },
      { webfinger: { 'admin@victim.test': adminId } }
    )

    await expect(
      recordActorIfNeeded({ actorId: adminId, database })
    ).resolves.toMatchObject({
      id: adminId,
      username: 'admin',
      domain: 'victim.test',
      publicKey: 'admin-key'
    })
  })

  // Lemmy answers `acct:lemmy@lemmy.ml` with BOTH the person and the
  // community of that name, each as a `self` link; the community must still
  // confirm even though the person is listed first.
  it('confirms against any self link, as Lemmy lists a person and a community', async () => {
    const communityId = 'https://lemmy.test/c/lemmy'
    serve(
      {
        [communityId]: actorDocument(communityId, 'community-key', {
          type: 'Group',
          preferredUsername: 'lemmy'
        })
      },
      {
        webfinger: {
          'lemmy@lemmy.test': {
            self: ['https://lemmy.test/u/lemmy', communityId],
            subject: 'acct:lemmy@lemmy.test'
          }
        }
      }
    )

    await expect(
      recordActorIfNeeded({ actorId: communityId, database })
    ).resolves.toMatchObject({ id: communityId, username: 'lemmy' })
  })

  // Only a new row is gated: it fixes `username@domain` for good, and the
  // refresh path re-fetches the row's own id and never rewrites its handle.
  // A WebFinger outage must not stop a known actor from refreshing.
  it('refreshes a stored actor without asking WebFinger again', async () => {
    serve(
      { [adminId]: actorDocument(adminId, 'admin-key') },
      { webfinger: { 'admin@victim.test': adminId } }
    )
    await recordActorIfNeeded({ actorId: adminId, database })
    await sql('actors')
      .where('id', adminId)
      .update({ updatedAt: new Date(Date.now() - 4 * 86_400_000) })
    serve({ [adminId]: actorDocument(adminId, 'rotated-key') })

    await expect(
      recordActorIfNeeded({ actorId: adminId, database })
    ).resolves.toMatchObject({ id: adminId, publicKey: 'rotated-key' })
  })

  describe('reads a fetched actor only when it is labelled ActivityPub', () => {
    // Every type each of these servers was observed serving an actor with:
    // Mastodon, Misskey, Akkoma and PeerTube send the charset form, Lemmy the
    // bare one. The JSON-LD form is the spec's other name.
    it.each([
      'application/activity+json',
      'application/activity+json; charset=utf-8',
      'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
    ])('records an actor served as %s', async (contentType) => {
      serve(
        {
          [adminId]: { body: actorDocument(adminId, 'admin-key'), contentType }
        },
        { webfinger: { 'admin@victim.test': adminId } }
      )

      await expect(
        recordActorIfNeeded({ actorId: adminId, database })
      ).resolves.toMatchObject({ id: adminId })
    })

    // WebFinger confirms the handle here, so only the type can refuse it.
    it.each([
      'application/json',
      'application/octet-stream',
      'text/plain',
      'application/ld+json'
    ])('refuses an actor served as %s', async (contentType) => {
      serve(
        {
          [adminId]: { body: actorDocument(adminId, 'admin-key'), contentType }
        },
        { webfinger: { 'admin@victim.test': adminId } }
      )

      await expect(
        recordActorIfNeeded({ actorId: adminId, database })
      ).resolves.toBeUndefined()
      await expect(database.getActorFromId({ id: adminId })).resolves.toBeNull()
    })
  })
})
