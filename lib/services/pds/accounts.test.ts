import { Secp256k1Keypair } from '@atproto/crypto'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { createBlueskyIdentityResolver } from '@/lib/services/bluesky/identityResolver'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import {
  changeHostedBlueskyHandle,
  createHostedBlueskyAccount,
  deactivateHostedBlueskyAccount,
  deleteHostedBlueskyAccount,
  getHostedBlueskyAccountState,
  reactivateHostedBlueskyAccount,
  setHostedBlueskyRecoveryKey
} from './accounts'
import { decodePdsEvent } from './events'
import {
  type PlcSignedOperation,
  cidForOperation,
  verifyPlcOperationSignature
} from './plc'
import { pruneDeletedPdsRepos } from './retention'

vi.mock('@/lib/utils/safeRemoteFetch', () => ({ safeRemoteFetch: vi.fn() }))
vi.mock('@/lib/services/bluesky/identityResolver', () => ({
  createBlueskyIdentityResolver: vi.fn()
}))

const ROTATION_KEY_HEX =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const PDS_HOSTNAME = `pds.${TEST_DOMAIN}`
const ALLOWED_USERNAMES = [
  'hosted-create',
  'hosted-nokey',
  'hosted-notallowed',
  'hosted-linked',
  'hosted-exists',
  'hosted-toggle',
  'hosted-handle',
  'hosted-unresolved',
  'hosted-recovery',
  'hosted-badrecovery',
  'hosted-delete',
  'hosted-recreate',
  'hosted-moderation',
  'hosted-actordelete',
  'hosted-state'
]

const ENABLED_PDS_ENV = JSON.stringify({
  [TEST_DOMAIN]: {
    enabled: true,
    hostname: PDS_HOSTNAME,
    allowEmails: [],
    allowActors: ALLOWED_USERNAMES.map(
      (username) => `${username}@${TEST_DOMAIN}`
    )
  }
})

const okResponse = (url: string, body = '', statusCode = 200) => ({
  body,
  bodyTruncated: false,
  headers: {},
  statusCode,
  url
})

type Submission = { url: string; operation: PlcSignedOperation }

describe('hosted Bluesky accounts', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  const originalPdsEnv = process.env.ACTIVITIES_BLUESKY_PDS
  const originalRotationKey = process.env.ACTIVITIES_BLUESKY_PDS_ROTATION_KEY
  let rotationKeypair: Secp256k1Keypair
  let submissions: Submission[]

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    rotationKeypair = await Secp256k1Keypair.import(
      Buffer.from(ROTATION_KEY_HEX, 'hex')
    )
  })

  beforeEach(() => {
    process.env.ACTIVITIES_BLUESKY_PDS = ENABLED_PDS_ENV
    process.env.ACTIVITIES_BLUESKY_PDS_ROTATION_KEY = ROTATION_KEY_HEX
    submissions = []
    vi.mocked(safeRemoteFetch).mockReset()
    vi.mocked(safeRemoteFetch).mockImplementation(async ({ url, body }) => {
      if (body) {
        submissions.push({
          url,
          operation: JSON.parse(body) as PlcSignedOperation
        })
      }
      return okResponse(url)
    })
    vi.mocked(createBlueskyIdentityResolver).mockReset()
  })

  afterAll(async () => {
    if (originalPdsEnv === undefined) {
      delete process.env.ACTIVITIES_BLUESKY_PDS
    } else {
      process.env.ACTIVITIES_BLUESKY_PDS = originalPdsEnv
    }
    if (originalRotationKey === undefined) {
      delete process.env.ACTIVITIES_BLUESKY_PDS_ROTATION_KEY
    } else {
      process.env.ACTIVITIES_BLUESKY_PDS_ROTATION_KEY = originalRotationKey
    }
    await database.destroy()
  })

  const createActor = async (username: string) => {
    await database.createAccount({
      email: `${username}@${TEST_DOMAIN}`,
      username,
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: `ap-priv-${username}`,
      publicKey: `ap-pub-${username}`
    })
    const actor = await database.getActorFromUsername({
      username,
      domain: TEST_DOMAIN
    })
    if (!actor) throw new Error(`Actor not created: ${username}`)
    return actor
  }

  const pdsHandle = (username: string) => `${username}.${PDS_HOSTNAME}`

  it('creates a did:plc account with a genesis op, repo row and events', async () => {
    const actor = await createActor('hosted-create')
    const handle = pdsHandle('hosted-create')

    const state = await createHostedBlueskyAccount({
      database,
      actor,
      handle
    })

    expect(state.repo).not.toBeNull()
    expect(state.repo?.handle).toBe(handle)
    expect(state.repo?.status).toBe('active')
    expect(state.repo?.did).toMatch(/^did:plc:[a-z2-7]{24}$/)

    // The genesis operation names the PDS host, the signing key, the handle and
    // the server rotation key, and is signed by the rotation key.
    expect(submissions).toHaveLength(1)
    const { url, operation } = submissions[0]
    expect(url).toBe(`https://plc.directory/${state.repo?.did}`)
    expect(operation.prev).toBeNull()
    expect(operation.rotationKeys).toEqual([rotationKeypair.did()])
    expect(operation.alsoKnownAs).toEqual([`at://${handle}`])
    expect(operation.services.atproto_pds).toEqual({
      type: 'AtprotoPersonalDataServer',
      endpoint: `https://${PDS_HOSTNAME}`
    })
    expect(operation.verificationMethods.atproto).toMatch(/^did:key:/)
    expect(
      await verifyPlcOperationSignature(operation, [rotationKeypair.did()])
    ).toBe(true)

    const repo = await database.getPdsRepo({ actorId: actor.id })
    expect(repo?.did).toBe(state.repo?.did)
    expect(repo?.handle).toBe(handle)
    expect(repo?.plcOperation).toBe(JSON.stringify(operation))

    const events = await database.listPdsEvents({ did: repo!.did })
    expect(events.map((event) => event.type)).toEqual([
      'identity',
      'account',
      'commit'
    ])
    expect(decodePdsEvent(events[0])).toMatchObject({
      type: 'identity',
      did: repo!.did,
      handle
    })
    expect(decodePdsEvent(events[1])).toMatchObject({
      type: 'account',
      did: repo!.did,
      active: true
    })
  })

  it('refuses creation without a rotation key', async () => {
    delete process.env.ACTIVITIES_BLUESKY_PDS_ROTATION_KEY
    const actor = await createActor('hosted-nokey')

    await expect(
      createHostedBlueskyAccount({
        database,
        actor,
        handle: pdsHandle('hosted-nokey')
      })
    ).rejects.toMatchObject({ code: 'RotationKeyMissing' })
    expect(submissions).toHaveLength(0)
    expect(await database.getPdsRepo({ actorId: actor.id })).toBeNull()
  })

  it('refuses creation for an actor who is not allowed', async () => {
    const actor = await createActor('hosted-notallowed')
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      [TEST_DOMAIN]: {
        enabled: true,
        hostname: PDS_HOSTNAME,
        allowEmails: [],
        allowActors: []
      }
    })

    await expect(
      createHostedBlueskyAccount({
        database,
        actor,
        handle: pdsHandle('hosted-notallowed')
      })
    ).rejects.toMatchObject({ code: 'PdsNotAllowed' })
    expect(submissions).toHaveLength(0)
  })

  it('refuses creation when a linked outside account exists', async () => {
    const actor = await createActor('hosted-linked')
    await database.saveBlueskyAccount({
      actorId: actor.id,
      did: 'did:plc:linkedoutsideaccount',
      handle: 'alice.bsky.social',
      pdsUrl: 'https://bsky.social',
      authType: 'app_password',
      domainHandle: false
    })

    await expect(
      createHostedBlueskyAccount({
        database,
        actor,
        handle: pdsHandle('hosted-linked')
      })
    ).rejects.toMatchObject({ code: 'HostedAccountLinked' })
    expect(submissions).toHaveLength(0)
  })

  it('refuses creation when the actor already has a repo', async () => {
    const actor = await createActor('hosted-exists')
    await createHostedBlueskyAccount({
      database,
      actor,
      handle: pdsHandle('hosted-exists')
    })

    await expect(
      createHostedBlueskyAccount({
        database,
        actor,
        handle: pdsHandle('hosted-exists')
      })
    ).rejects.toMatchObject({ code: 'HostedAccountExists' })
  })

  it('deactivates and reactivates with #account events the firehose carries', async () => {
    const actor = await createActor('hosted-toggle')
    await createHostedBlueskyAccount({
      database,
      actor,
      handle: pdsHandle('hosted-toggle')
    })
    const repo = await database.getPdsRepo({ actorId: actor.id })

    await deactivateHostedBlueskyAccount({ database, actor })
    expect((await database.getPdsRepo({ actorId: actor.id }))?.status).toBe(
      'deactivated'
    )

    const afterDeactivate = await database.listPdsEvents({
      did: repo!.did,
      activeReposOnly: true,
      domain: TEST_DOMAIN
    })
    const deactivated = afterDeactivate
      .map(decodePdsEvent)
      .filter((event) => event.type === 'account')
      .at(-1)
    expect(deactivated).toMatchObject({
      type: 'account',
      active: false,
      status: 'deactivated'
    })

    await reactivateHostedBlueskyAccount({ database, actor })
    expect((await database.getPdsRepo({ actorId: actor.id }))?.status).toBe(
      'active'
    )
    const afterReactivate = await database.listPdsEvents({
      did: repo!.did,
      activeReposOnly: true,
      domain: TEST_DOMAIN
    })
    const reactivated = afterReactivate
      .map(decodePdsEvent)
      .filter((event) => event.type === 'account')
      .at(-1)
    expect(reactivated).toMatchObject({ type: 'account', active: true })
  })

  it('changes the handle with a chained PLC update and #identity', async () => {
    const actor = await createActor('hosted-handle')
    await createHostedBlueskyAccount({
      database,
      actor,
      handle: pdsHandle('hosted-handle')
    })
    const repo = await database.getPdsRepo({ actorId: actor.id })
    const genesis = JSON.parse(repo!.plcOperation!) as PlcSignedOperation
    const genesisCid = await cidForOperation(genesis)

    vi.mocked(createBlueskyIdentityResolver).mockReturnValue({
      resolve: async () => ({ did: repo!.did })
    } as unknown as ReturnType<typeof createBlueskyIdentityResolver>)

    submissions = []
    await changeHostedBlueskyHandle({
      database,
      actor,
      handle: 'alice.example.com'
    })

    expect(submissions).toHaveLength(1)
    const { operation } = submissions[0]
    expect(operation.prev).toBe(genesisCid)
    expect(operation.alsoKnownAs).toEqual(['at://alice.example.com'])
    expect(
      await verifyPlcOperationSignature(operation, [rotationKeypair.did()])
    ).toBe(true)

    const updated = await database.getPdsRepo({ actorId: actor.id })
    expect(updated?.handle).toBe('alice.example.com')
    expect(updated?.plcOperation).toBe(JSON.stringify(operation))

    const events = await database.listPdsEvents({ did: repo!.did })
    expect(decodePdsEvent(events.at(-1)!)).toMatchObject({
      type: 'identity',
      handle: 'alice.example.com'
    })
  })

  it('refuses a custom handle that does not resolve to the DID', async () => {
    const actor = await createActor('hosted-unresolved')
    await createHostedBlueskyAccount({
      database,
      actor,
      handle: pdsHandle('hosted-unresolved')
    })
    vi.mocked(createBlueskyIdentityResolver).mockReturnValue({
      resolve: async () => ({ did: 'did:plc:someoneelse' })
    } as unknown as ReturnType<typeof createBlueskyIdentityResolver>)

    await expect(
      changeHostedBlueskyHandle({
        database,
        actor,
        handle: 'bob.example.com'
      })
    ).rejects.toMatchObject({ code: 'HandleNotResolved' })
  })

  it('adds a recovery key first in rotationKeys and removes it', async () => {
    const actor = await createActor('hosted-recovery')
    await createHostedBlueskyAccount({
      database,
      actor,
      handle: pdsHandle('hosted-recovery')
    })
    const recoveryKey = await Secp256k1Keypair.create()
    const recoveryDid = recoveryKey.did()

    submissions = []
    await setHostedBlueskyRecoveryKey({
      database,
      actor,
      recoveryKeyDid: recoveryDid
    })
    expect(submissions[0].operation.rotationKeys).toEqual([
      recoveryDid,
      rotationKeypair.did()
    ])
    expect(
      (await database.getPdsRepo({ actorId: actor.id }))?.recoveryKeyDid
    ).toBe(recoveryDid)

    submissions = []
    await setHostedBlueskyRecoveryKey({
      database,
      actor,
      recoveryKeyDid: null
    })
    expect(submissions[0].operation.rotationKeys).toEqual([
      rotationKeypair.did()
    ])
    expect(
      (await database.getPdsRepo({ actorId: actor.id }))?.recoveryKeyDid
    ).toBeNull()
  })

  it('refuses an unsupported recovery key', async () => {
    const actor = await createActor('hosted-badrecovery')
    await createHostedBlueskyAccount({
      database,
      actor,
      handle: pdsHandle('hosted-badrecovery')
    })

    await expect(
      setHostedBlueskyRecoveryKey({
        database,
        actor,
        recoveryKeyDid: 'did:key:not-a-key'
      })
    ).rejects.toMatchObject({ code: 'RecoveryKeyInvalid' })
  })

  it('deletes with a confirmed handle, keeps the tombstone and retention removes it', async () => {
    const actor = await createActor('hosted-delete')
    const handle = pdsHandle('hosted-delete')
    await createHostedBlueskyAccount({ database, actor, handle })
    const repo = await database.getPdsRepo({ actorId: actor.id })

    await expect(
      deleteHostedBlueskyAccount({
        database,
        actor,
        confirmHandle: 'wrong.example.com'
      })
    ).rejects.toMatchObject({ code: 'ConfirmHandleMismatch' })

    await deleteHostedBlueskyAccount({
      database,
      actor,
      confirmHandle: handle
    })

    // The tombstone keeps its DID but gives up the actor's slot.
    expect(await database.getPdsRepo({ actorId: actor.id })).toBeNull()
    const tombstone = await database.getPdsRepo({ did: repo!.did })
    expect(tombstone?.status).toBe('deleted')
    expect(
      await database.listPdsRecords({
        did: repo!.did,
        collection: 'app.bsky.feed.post'
      })
    ).toEqual({
      records: []
    })

    const events = await database.listPdsEvents({ did: repo!.did })
    expect(decodePdsEvent(events.at(-1)!)).toMatchObject({
      type: 'account',
      active: false,
      status: 'deleted'
    })

    // The firehose still carries the account event for the deleted repo.
    const firehose = await database.listPdsEvents({
      did: repo!.did,
      activeReposOnly: true,
      domain: TEST_DOMAIN
    })
    expect(
      firehose.map(decodePdsEvent).some((event) => event.type === 'account')
    ).toBe(true)

    // Retention keeps it inside the window and removes it after 7 days.
    expect(await pruneDeletedPdsRepos(database)).toBe(0)
    expect(
      await pruneDeletedPdsRepos(database, {
        now: Date.now() + 8 * 24 * 60 * 60 * 1000
      })
    ).toBe(1)
    expect(await database.getPdsRepo({ actorId: actor.id })).toBeNull()
    expect(await database.listPdsEvents({ did: repo!.did })).toEqual([])
  })

  it('sends #account events for moderation suspend and unsuspend', async () => {
    const actor = await createActor('hosted-moderation')
    await createHostedBlueskyAccount({
      database,
      actor,
      handle: pdsHandle('hosted-moderation')
    })
    const repo = await database.getPdsRepo({ actorId: actor.id })

    await database.applyModerationAction({
      targetActorId: actor.id,
      accountId: actor.account!.id,
      action: 'suspend',
      moderatorAccountId: 'moderator'
    })
    let events = await database.listPdsEvents({ did: repo!.did })
    expect(decodePdsEvent(events.at(-1)!)).toMatchObject({
      type: 'account',
      active: false,
      status: 'takendown'
    })

    await database.applyModerationAction({
      targetActorId: actor.id,
      accountId: actor.account!.id,
      action: 'unsuspend',
      moderatorAccountId: 'moderator'
    })
    events = await database.listPdsEvents({ did: repo!.did })
    expect(decodePdsEvent(events.at(-1)!)).toMatchObject({
      type: 'account',
      active: true
    })
  })

  it('creates a new account after deleting one', async () => {
    const actor = await createActor('hosted-recreate')
    const handle = pdsHandle('hosted-recreate')
    await createHostedBlueskyAccount({ database, actor, handle })
    const first = await database.getPdsRepo({ actorId: actor.id })
    await deleteHostedBlueskyAccount({ database, actor, confirmHandle: handle })

    await createHostedBlueskyAccount({ database, actor, handle })

    const second = await database.getPdsRepo({ actorId: actor.id })
    expect(second?.status).toBe('active')
    expect(second?.did).not.toBe(first!.did)
    expect((await database.getPdsRepo({ did: first!.did }))?.status).toBe(
      'deleted'
    )
  })

  it('leaves a tombstone and an account-deleted event on actor deletion', async () => {
    const actor = await createActor('hosted-actordelete')
    await createHostedBlueskyAccount({
      database,
      actor,
      handle: pdsHandle('hosted-actordelete')
    })
    const repo = await database.getPdsRepo({ actorId: actor.id })

    await database.deleteActorData({ actorId: actor.id })

    const tombstone = await database.getPdsRepo({ did: repo!.did })
    expect(tombstone?.status).toBe('deleted')
    const events = await database.listPdsEvents({ did: repo!.did })
    expect(decodePdsEvent(events.at(-1)!)).toMatchObject({
      type: 'account',
      active: false,
      status: 'deleted'
    })
    // The actor row is gone, but the firehose still carries the account event.
    const firehose = await database.listPdsEvents({
      did: repo!.did,
      activeReposOnly: true,
      domain: TEST_DOMAIN
    })
    expect(
      firehose.map(decodePdsEvent).some((event) => event.type === 'account')
    ).toBe(true)
  })

  it('reports the card state and handle choices', async () => {
    const actor = await createActor('hosted-state')
    const state = await getHostedBlueskyAccountState({ database, actor })
    expect(state.available).toBe(true)
    expect(state.pdsHostname).toBe(PDS_HOSTNAME)
    expect(state.rotationKeyConfigured).toBe(true)
    expect(state.repo).toBeNull()
    expect(state.handleChoices).toEqual([
      { handle: pdsHandle('hosted-state'), kind: 'pds' }
    ])
    expect(state.customHandleAllowed).toBe(false)
  })
})
