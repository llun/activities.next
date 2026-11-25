import { Secp256k1Keypair } from '@atproto/crypto'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { createBlueskyIdentityResolver } from '@/lib/services/bluesky/identityResolver'
import {
  resetServedDomainsForTests,
  setServedDomainsForTests
} from '@/lib/services/domains/servedDomainSnapshot'
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
  createUpdateOperation,
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
  'hosted-state',
  'hosted-gate-allow',
  'hosted-gate-disabled',
  'hosted-rate-create',
  'hosted-rate-handle',
  'hosted-rate-recovery',
  'hosted-chain-stale',
  'hosted-chain-moved',
  'hosted-chain-swap',
  'hosted-collide',
  'hosted-collide-pds',
  'hosted-race',
  'hosted-acct-a',
  'hosted-acct-b',
  'hosted-mod-disable',
  'hosted-mod-suspend',
  'hosted-mod-off',
  'hosted-mod-deleting',
  'hosted-limited',
  'hosted-effective',
  'hosted_under',
  'hosted-inactive-handle',
  'hosted-avail-blocked',
  'hosted-avail-off'
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

const DIRECTORY = 'https://plc.directory'

describe('hosted Bluesky accounts', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  const originalPdsEnv = process.env.ACTIVITIES_BLUESKY_PDS
  const originalRotationKey = process.env.ACTIVITIES_BLUESKY_PDS_ROTATION_KEY
  let rotationKeypair: Secp256k1Keypair
  let submissions: Submission[]
  // The fake PLC directory: every accepted operation per DID, last one last.
  const directoryLog = new Map<string, PlcSignedOperation[]>()

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
      const did = url.slice(DIRECTORY.length + 1).replace(/\/log\/last$/, '')
      if (body) {
        const operation = JSON.parse(body) as PlcSignedOperation
        submissions.push({ url, operation })
        directoryLog.set(did, [...(directoryLog.get(did) ?? []), operation])
        return okResponse(url)
      }
      const last = directoryLog.get(did)?.at(-1)
      return last
        ? okResponse(url, JSON.stringify(last))
        : okResponse(url, '', 404)
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

  const countEvents = async (did: string) =>
    (await database.listPdsEvents({ did })).length

  it('refuses a handle or recovery key change once the actor leaves the allowlist', async () => {
    const actor = await createActor('hosted-gate-allow')
    await createHostedBlueskyAccount({
      database,
      actor,
      handle: pdsHandle('hosted-gate-allow')
    })
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      [TEST_DOMAIN]: {
        enabled: true,
        hostname: PDS_HOSTNAME,
        allowEmails: [],
        allowActors: []
      }
    })
    submissions = []

    await expect(
      changeHostedBlueskyHandle({
        database,
        actor,
        handle: pdsHandle('hosted-gate-allow')
      })
    ).rejects.toMatchObject({ code: 'PdsNotAllowed' })
    await expect(
      setHostedBlueskyRecoveryKey({
        database,
        actor,
        recoveryKeyDid: (await Secp256k1Keypair.create()).did()
      })
    ).rejects.toMatchObject({ code: 'PdsNotAllowed' })
    expect(submissions).toHaveLength(0)
  })

  it('refuses a handle or recovery key change on a disabled domain', async () => {
    const actor = await createActor('hosted-gate-disabled')
    await createHostedBlueskyAccount({
      database,
      actor,
      handle: pdsHandle('hosted-gate-disabled')
    })
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      [TEST_DOMAIN]: {
        ...JSON.parse(ENABLED_PDS_ENV)[TEST_DOMAIN],
        enabled: false
      }
    })
    submissions = []

    await expect(
      changeHostedBlueskyHandle({
        database,
        actor,
        handle: pdsHandle('hosted-gate-disabled')
      })
    ).rejects.toMatchObject({ code: 'PdsDisabled' })
    await expect(
      setHostedBlueskyRecoveryKey({ database, actor, recoveryKeyDid: null })
    ).rejects.toMatchObject({ code: 'PdsDisabled' })
    expect(submissions).toHaveLength(0)
  })

  it('limits account creation to 3 a day', async () => {
    const actor = await createActor('hosted-rate-create')
    const handle = pdsHandle('hosted-rate-create')
    // An attempt refused by validation does not count.
    await expect(
      createHostedBlueskyAccount({ database, actor, handle: 'other.example' })
    ).rejects.toMatchObject({ code: 'HandleNotAllowed' })
    for (let i = 0; i < 3; i++) {
      await createHostedBlueskyAccount({ database, actor, handle })
      await deleteHostedBlueskyAccount({
        database,
        actor,
        confirmHandle: handle
      })
    }
    submissions = []

    await expect(
      createHostedBlueskyAccount({ database, actor, handle })
    ).rejects.toMatchObject({ code: 'RateLimited', statusCode: 429 })
    expect(submissions).toHaveLength(0)
    expect(await database.getPdsRepo({ actorId: actor.id })).toBeNull()
  })

  it('limits handle changes to 10 a day, counting only valid attempts', async () => {
    const actor = await createActor('hosted-rate-handle')
    const handle = pdsHandle('hosted-rate-handle')
    await createHostedBlueskyAccount({ database, actor, handle })
    for (let i = 0; i < 3; i++) {
      await expect(
        changeHostedBlueskyHandle({ database, actor, handle: 'not a handle' })
      ).rejects.toMatchObject({ code: 'InvalidRequest' })
    }
    for (let i = 0; i < 10; i++) {
      await changeHostedBlueskyHandle({ database, actor, handle })
    }
    submissions = []

    await expect(
      changeHostedBlueskyHandle({ database, actor, handle })
    ).rejects.toMatchObject({ code: 'RateLimited', statusCode: 429 })
    expect(submissions).toHaveLength(0)
  })

  it('limits recovery key changes to 10 a day, counting only valid attempts', async () => {
    const actor = await createActor('hosted-rate-recovery')
    await createHostedBlueskyAccount({
      database,
      actor,
      handle: pdsHandle('hosted-rate-recovery')
    })
    for (let i = 0; i < 3; i++) {
      await expect(
        setHostedBlueskyRecoveryKey({
          database,
          actor,
          recoveryKeyDid: 'did:key:not-a-key'
        })
      ).rejects.toMatchObject({ code: 'RecoveryKeyInvalid' })
    }
    for (let i = 0; i < 10; i++) {
      await setHostedBlueskyRecoveryKey({
        database,
        actor,
        recoveryKeyDid: null
      })
    }
    submissions = []

    await expect(
      setHostedBlueskyRecoveryKey({ database, actor, recoveryKeyDid: null })
    ).rejects.toMatchObject({ code: 'RateLimited', statusCode: 429 })
    expect(submissions).toHaveLength(0)
  })

  // An operation the owner signed with their own key and sent to the
  // directory directly: this server never stored it.
  const appendOwnerOperation = async (
    did: string,
    owner: Secp256k1Keypair,
    rotationKeys: string[]
  ) => {
    const last = directoryLog.get(did)!.at(-1)!
    const operation = await createUpdateOperation({
      previous: last,
      previousCid: await cidForOperation(last),
      changes: { rotationKeys },
      rotationKeypair: owner
    })
    directoryLog.get(did)!.push(operation)
    return operation
  }

  it('chains an update on the directory’s last operation, not a stale stored one', async () => {
    const actor = await createActor('hosted-chain-stale')
    await createHostedBlueskyAccount({
      database,
      actor,
      handle: pdsHandle('hosted-chain-stale')
    })
    const repo = await database.getPdsRepo({ actorId: actor.id })
    const owner = await Secp256k1Keypair.create()
    const ownerOperation = await appendOwnerOperation(repo!.did, owner, [
      owner.did(),
      rotationKeypair.did()
    ])
    submissions = []

    await changeHostedBlueskyHandle({
      database,
      actor,
      handle: pdsHandle('hosted-chain-stale')
    })

    expect(submissions).toHaveLength(1)
    const { operation } = submissions[0]
    expect(operation.prev).toBe(await cidForOperation(ownerOperation))
    // The owner's rotation keys are kept, not reverted to the stored ones.
    expect(operation.rotationKeys).toEqual([owner.did(), rotationKeypair.did()])
    expect(
      (await database.getPdsRepo({ actorId: actor.id }))?.plcOperation
    ).toBe(JSON.stringify(operation))
  })

  it('refuses an update once the directory no longer lists the server rotation key', async () => {
    const actor = await createActor('hosted-chain-moved')
    await createHostedBlueskyAccount({
      database,
      actor,
      handle: pdsHandle('hosted-chain-moved')
    })
    const repo = await database.getPdsRepo({ actorId: actor.id })
    const owner = await Secp256k1Keypair.create()
    await appendOwnerOperation(repo!.did, owner, [owner.did()])
    submissions = []

    await expect(
      setHostedBlueskyRecoveryKey({ database, actor, recoveryKeyDid: null })
    ).rejects.toMatchObject({ code: 'IdentityMoved' })
    expect(submissions).toHaveLength(0)
  })

  it('chains on an operation the owner signed with a key it swapped out', async () => {
    const actor = await createActor('hosted-chain-swap')
    await createHostedBlueskyAccount({
      database,
      actor,
      handle: pdsHandle('hosted-chain-swap')
    })
    const repo = await database.getPdsRepo({ actorId: actor.id })
    const oldKey = await Secp256k1Keypair.create()
    const newKey = await Secp256k1Keypair.create()
    await appendOwnerOperation(repo!.did, rotationKeypair, [
      oldKey.did(),
      rotationKeypair.did()
    ])
    // Signed by the old recovery key, which the operation itself no longer lists.
    const swap = await appendOwnerOperation(repo!.did, oldKey, [
      newKey.did(),
      rotationKeypair.did()
    ])
    submissions = []

    await changeHostedBlueskyHandle({
      database,
      actor,
      handle: pdsHandle('hosted-chain-swap')
    })

    expect(submissions).toHaveLength(1)
    expect(submissions[0].operation.prev).toBe(await cidForOperation(swap))
    expect(submissions[0].operation.rotationKeys).toEqual([
      newKey.did(),
      rotationKeypair.did()
    ])
  })

  describe('a PDS handle another host owns', () => {
    afterEach(() => {
      resetServedDomainsForTests()
    })

    it('is not offered or accepted when it names a served domain', async () => {
      const actor = await createActor('hosted-collide')
      const handle = pdsHandle('hosted-collide')
      setServedDomainsForTests([handle])

      const state = await getHostedBlueskyAccountState({ database, actor })
      expect(state.handleChoices).toEqual([])
      await expect(
        createHostedBlueskyAccount({ database, actor, handle })
      ).rejects.toMatchObject({ code: 'HandleNotAllowed' })
      expect(submissions).toHaveLength(0)
    })

    it('is not accepted on a handle change when it names another PDS hostname', async () => {
      const actor = await createActor('hosted-collide-pds')
      const handle = pdsHandle('hosted-collide-pds')
      await createHostedBlueskyAccount({ database, actor, handle })
      process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
        ...JSON.parse(ENABLED_PDS_ENV),
        'other.example': {
          enabled: true,
          hostname: handle,
          allowEmails: [],
          allowActors: []
        }
      })
      submissions = []

      expect(
        (await getHostedBlueskyAccountState({ database, actor })).handleChoices
      ).toEqual([])
      await expect(
        changeHostedBlueskyHandle({ database, actor, handle })
      ).rejects.toMatchObject({ code: 'HandleNotAllowed' })
      expect(createBlueskyIdentityResolver).not.toHaveBeenCalled()
      expect(submissions).toHaveLength(0)
    })
  })

  it('leaves the tombstone untouched when a toggle or handle change lands after delete', async () => {
    const actor = await createActor('hosted-race')
    const handle = pdsHandle('hosted-race')
    await createHostedBlueskyAccount({ database, actor, handle })
    const stale = await database.getPdsRepo({ actorId: actor.id })
    await deleteHostedBlueskyAccount({ database, actor, confirmHandle: handle })
    const tombstone = await database.getPdsRepo({ did: stale!.did })
    const eventsBefore = await countEvents(stale!.did)

    // Each action read the repo before the delete landed.
    const getPdsRepo = vi.spyOn(database, 'getPdsRepo')
    try {
      getPdsRepo.mockResolvedValueOnce(stale)
      await deactivateHostedBlueskyAccount({ database, actor })
      getPdsRepo.mockResolvedValueOnce(stale)
      await changeHostedBlueskyHandle({ database, actor, handle })
    } finally {
      getPdsRepo.mockRestore()
    }

    expect(await database.getPdsRepo({ did: stale!.did })).toEqual(tombstone)
    expect(await countEvents(stale!.did)).toBe(eventsBefore)
  })

  describe('moderation #account events', () => {
    const moderate = (
      actor: Awaited<ReturnType<typeof createActor>>,
      action: 'suspend' | 'unsuspend' | 'disable' | 'enable'
    ) =>
      database.applyModerationAction({
        targetActorId: actor.id,
        accountId: actor.account!.id,
        action,
        moderatorAccountId: 'moderator'
      })

    const accountEvents = async (did: string) =>
      (await database.listPdsEvents({ did }))
        .map(decodePdsEvent)
        .filter((event) => event.type === 'account')

    const hosted = async (actor: Awaited<ReturnType<typeof createActor>>) => {
      await createHostedBlueskyAccount({
        database,
        actor,
        handle: pdsHandle(actor.username)
      })
      return (await database.getPdsRepo({ actorId: actor.id }))!.did
    }

    it('announces disable and enable for every profile of the account', async () => {
      const first = await createActor('hosted-acct-a')
      await database.createActorForAccount({
        accountId: first.account!.id,
        username: 'hosted-acct-b',
        domain: TEST_DOMAIN,
        privateKey: 'ap-priv-hosted-acct-b',
        publicKey: 'ap-pub-hosted-acct-b'
      })
      const second = (await database.getActorFromUsername({
        username: 'hosted-acct-b',
        domain: TEST_DOMAIN
      }))!
      const firstDid = await hosted(first)
      const secondDid = await hosted(second)

      await moderate(first, 'disable')
      for (const did of [firstDid, secondDid]) {
        expect((await accountEvents(did)).at(-1)).toMatchObject({
          active: false,
          status: 'takendown'
        })
      }

      // The second profile is also suspended, so enabling leaves it off.
      await moderate(second, 'suspend')
      const secondBefore = (await accountEvents(secondDid)).length
      await moderate(first, 'enable')
      expect((await accountEvents(firstDid)).at(-1)).toMatchObject({
        active: true
      })
      expect(await accountEvents(secondDid)).toHaveLength(secondBefore)
    })

    it('does not announce active:true on unsuspend while the account is disabled', async () => {
      const actor = await createActor('hosted-mod-disable')
      const did = await hosted(actor)
      await moderate(actor, 'disable')
      await moderate(actor, 'suspend')
      const before = await accountEvents(did)

      await moderate(actor, 'unsuspend')

      expect(await accountEvents(did)).toHaveLength(before.length)
    })

    it('does not announce active:true on enable while the profile is suspended', async () => {
      const actor = await createActor('hosted-mod-suspend')
      const did = await hosted(actor)
      await moderate(actor, 'suspend')
      await moderate(actor, 'disable')
      const before = await accountEvents(did)

      await moderate(actor, 'enable')

      expect(await accountEvents(did)).toHaveLength(before.length)
    })

    it('announces nothing on unsuspend for a repo its owner turned off', async () => {
      const actor = await createActor('hosted-mod-off')
      const did = await hosted(actor)
      await deactivateHostedBlueskyAccount({ database, actor })
      await moderate(actor, 'suspend')
      const before = await accountEvents(did)

      await moderate(actor, 'unsuspend')

      expect(await accountEvents(did)).toHaveLength(before.length)
    })

    it('does not announce active:true on unsuspend for a profile being deleted', async () => {
      const actor = await createActor('hosted-mod-deleting')
      const did = await hosted(actor)
      await moderate(actor, 'suspend')
      await database.scheduleActorDeletion({
        actorId: actor.id,
        scheduledAt: new Date(Date.now() + 60_000)
      })
      const before = await accountEvents(did)

      await moderate(actor, 'unsuspend')

      expect(await accountEvents(did)).toHaveLength(before.length)
    })
  })

  const disallowEveryone = () => {
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      [TEST_DOMAIN]: {
        enabled: true,
        hostname: PDS_HOSTNAME,
        allowEmails: [],
        allowActors: []
      }
    })
  }

  it('lets a profile the server no longer offers accounts to turn its account off and delete it', async () => {
    const actor = await createActor('hosted-limited')
    const handle = pdsHandle('hosted-limited')
    await createHostedBlueskyAccount({ database, actor, handle })
    disallowEveryone()

    const state = await getHostedBlueskyAccountState({ database, actor })
    expect(state.available).toBe(false)
    expect(state.repo?.status).toBe('active')

    await deactivateHostedBlueskyAccount({ database, actor })
    await expect(
      reactivateHostedBlueskyAccount({ database, actor })
    ).rejects.toMatchObject({ code: 'PdsNotAllowed' })
    await deleteHostedBlueskyAccount({ database, actor, confirmHandle: handle })
    expect(await database.getPdsRepo({ actorId: actor.id })).toBeNull()
  })

  it('reports the effective status on the card', async () => {
    const actor = await createActor('hosted-effective')
    await createHostedBlueskyAccount({
      database,
      actor,
      handle: pdsHandle('hosted-effective')
    })

    const status = async (overrides: Partial<typeof actor>) =>
      (
        await getHostedBlueskyAccountState({
          database,
          actor: { ...actor, ...overrides }
        })
      ).repo?.status

    expect(await status({})).toBe('active')
    expect(await status({ suspendedAt: Date.now() })).toBe('takendown')
    expect(
      await status({ account: { ...actor.account!, disabledAt: Date.now() } })
    ).toBe('takendown')
    expect(await status({ deletionStatus: 'scheduled' })).toBe('deactivated')
    expect(
      await status({ account: { ...actor.account!, approvedAt: null } })
    ).toBe('deactivated')
  })

  it('does not offer <username>.<PDS host> when the username is not a valid handle', async () => {
    const actor = await createActor('hosted_under')

    const state = await getHostedBlueskyAccountState({ database, actor })
    expect(state.available).toBe(true)
    expect(state.handleChoices).toEqual([])
    await expect(
      createHostedBlueskyAccount({
        database,
        actor,
        handle: pdsHandle('hosted_under')
      })
    ).rejects.toMatchObject({ code: 'InvalidRequest' })
    expect(submissions).toHaveLength(0)
  })

  it('refuses a handle change while the account is off', async () => {
    const actor = await createActor('hosted-inactive-handle')
    const handle = pdsHandle('hosted-inactive-handle')
    await createHostedBlueskyAccount({ database, actor, handle })
    await deactivateHostedBlueskyAccount({ database, actor })
    submissions = []

    await expect(
      changeHostedBlueskyHandle({ database, actor, handle })
    ).rejects.toMatchObject({ code: 'HostedAccountInactive', statusCode: 409 })
    expect(submissions).toHaveLength(0)
  })

  describe('available', () => {
    it('is false for an actor who is not allowed', async () => {
      const actor = await createActor('hosted-notallowed-state')
      expect(
        (await getHostedBlueskyAccountState({ database, actor })).available
      ).toBe(false)
    })

    it('is false for a blocked actor', async () => {
      const actor = await createActor('hosted-avail-blocked')
      expect(
        (
          await getHostedBlueskyAccountState({
            database,
            actor: { ...actor, suspendedAt: Date.now() }
          })
        ).available
      ).toBe(false)
      expect(
        (
          await getHostedBlueskyAccountState({
            database,
            actor: {
              ...actor,
              account: { ...actor.account!, approvedAt: null }
            }
          })
        ).available
      ).toBe(false)
    })

    it('is false on a domain with the PDS off', async () => {
      const actor = await createActor('hosted-avail-off')
      process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
        [TEST_DOMAIN]: {
          ...JSON.parse(ENABLED_PDS_ENV)[TEST_DOMAIN],
          enabled: false
        }
      })
      expect(
        (await getHostedBlueskyAccountState({ database, actor })).available
      ).toBe(false)
    })
  })
})
