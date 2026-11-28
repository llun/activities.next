import { Secp256k1Keypair } from '@atproto/crypto'
import { NextRequest } from 'next/server'

import { GET as getAtprotoDid } from '@/app/api/well-known/atproto-did/route'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import {
  BlueskyLinkError,
  checkBlueskyHandle,
  getBlueskyAccountState,
  linkBlueskyAppPassword,
  setBlueskyInstanceHandle,
  startBlueskyOAuth,
  unlinkBluesky
} from '@/lib/services/bluesky/account'
import { writeStoredBlueskySession } from '@/lib/services/bluesky/client'
import { createBlueskyIdentityResolver } from '@/lib/services/bluesky/identityResolver'
import {
  resetServedDomainsForTests,
  setServedDomainsForTests,
  setServedHostingPoliciesForTests
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
import { deletePdsBlobFilesBestEffort } from './blobStorage'
import { PdsAccountMovedError, PdsMoveOutPendingError } from './errors'
import { decodePdsEvent } from './events'
import { withPdsRepoLock } from './lock'
import {
  type PlcSignedOperation,
  cidForOperation,
  createUpdateOperation,
  verifyPlcOperationSignature
} from './plc'
import { pruneDeletedPdsRepos } from './retention'

vi.mock('@/lib/utils/safeRemoteFetch', () => ({ safeRemoteFetch: vi.fn() }))
// The atproto-did route reads this file's test database.
const routeDatabase = vi.hoisted(() => ({
  current: null as Database | null
}))
vi.mock('@/lib/database', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDatabase: () => routeDatabase.current
}))
// Pass-throughs the tests watch: lock entries and blob file deletes.
vi.mock('@/lib/services/pds/lock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lock')>()
  return { ...actual, withPdsRepoLock: vi.fn(actual.withPdsRepoLock) }
})
vi.mock('@/lib/services/pds/blobStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./blobStorage')>()
  return {
    ...actual,
    deletePdsBlobFilesBestEffort: vi.fn(actual.deletePdsBlobFilesBestEffort)
  }
})
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
  'hosted-avail-off',
  'hosted-concurrent',
  'hosted-taken-create',
  'hosted-taken-change',
  'hosted-taken-race',
  'hosted-taken-race2',
  'hosted-taken-crossdomain',
  'hosted-gate-blocked',
  'hosted-delete-order',
  'hosted-delete-partial',
  'hosted-admin-a',
  'hosted-admin-b',
  'hosted-admin-c',
  'hosted-plain',
  'hosted-row',
  'hosted-row-backfill',
  'hosted-row-stale',
  'hosted-row-guard',
  'hosted-row-orphan',
  'hosted-row-flipfail',
  'hosted-row-race',
  'hosted-row-relinked',
  'hosted-row-recreated',
  'hosted-moved-guard',
  'hosted-move-pending',
  'hosted-policy-nobody',
  'hosted-policy-everyone',
  'hosted-policy-blocked'
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

  describe('a domain’s saved hosting policy', () => {
    afterEach(() => {
      resetServedDomainsForTests()
    })

    it('lets a profile outside the environment lists host under "everyone"', async () => {
      const actor = await createActor('hosted-policy-everyone')
      setServedHostingPoliciesForTests({
        [TEST_DOMAIN]: { policy: 'everyone', allowEmails: [], allowActors: [] }
      })

      const state = await createHostedBlueskyAccount({
        database,
        actor,
        handle: pdsHandle('hosted-policy-everyone')
      })

      expect(state.repo?.status).toBe('active')
      expect(submissions).toHaveLength(1)
    })

    it('refuses an allowlisted profile under "nobody"', async () => {
      const actor = await createActor('hosted-policy-nobody')
      setServedHostingPoliciesForTests({
        [TEST_DOMAIN]: { policy: 'nobody', allowEmails: [], allowActors: [] }
      })

      await expect(
        createHostedBlueskyAccount({
          database,
          actor,
          handle: pdsHandle('hosted-policy-nobody')
        })
      ).rejects.toMatchObject({ code: 'PdsNotAllowed' })
      expect(submissions).toHaveLength(0)
    })

    it('still applies the blocked checks under "everyone"', async () => {
      const actor = await createActor('hosted-policy-blocked')
      setServedHostingPoliciesForTests({
        [TEST_DOMAIN]: { policy: 'everyone', allowEmails: [], allowActors: [] }
      })
      const suspended = { ...actor, suspendedAt: Date.now() }

      expect(
        (await getHostedBlueskyAccountState({ database, actor: suspended }))
          .available
      ).toBe(false)
      await expect(
        createHostedBlueskyAccount({
          database,
          actor: suspended,
          handle: pdsHandle('hosted-policy-blocked')
        })
      ).rejects.toMatchObject({ code: 'PdsNotAllowed' })
      expect(submissions).toHaveLength(0)
    })
  })

  it('runs one create per actor at a time, so a concurrent one registers no DID', async () => {
    const actor = await createActor('hosted-concurrent')
    const handle = pdsHandle('hosted-concurrent')
    const lockKey = `actor:${actor.id}`

    // The first submit stays open until the second create is either waiting
    // at the actor lock or, with no lock, has passed its checks and submits.
    let secondArrived!: () => void
    const arrived = new Promise<void>((resolve) => {
      secondArrived = resolve
    })
    let lockEntries = 0
    const realLock = vi.mocked(withPdsRepoLock).getMockImplementation()!
    vi.mocked(withPdsRepoLock).mockImplementation((db, key, fn, options) => {
      if (key === lockKey && ++lockEntries === 2) secondArrived()
      return realLock(db, key, fn, options)
    })
    let posts = 0
    const directory = vi.mocked(safeRemoteFetch).getMockImplementation()!
    vi.mocked(safeRemoteFetch).mockImplementation(async (options) => {
      if (options.body && ++posts === 1) {
        await arrived
      } else if (options.body) {
        secondArrived()
      }
      return directory(options)
    })

    try {
      const results = await Promise.allSettled([
        createHostedBlueskyAccount({ database, actor, handle }),
        createHostedBlueskyAccount({ database, actor, handle })
      ])

      expect(submissions).toHaveLength(1)
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { code: 'HostedAccountExists' }
      })
    } finally {
      vi.mocked(withPdsRepoLock).mockImplementation(realLock)
    }
  })

  // A live repo on this domain that already holds `handle`, as a moved custom
  // domain would leave behind.
  const holdHandle = (name: string, handle: string) =>
    database.createPdsRepo({
      did: `did:plc:${name}`,
      actorId: `https://${TEST_DOMAIN}/users/holder-${name}`,
      domain: TEST_DOMAIN,
      signingKey: `v1:key-${name}`,
      signingKeyDid: `did:key:zQ3sh${name}`,
      handle
    })

  it('refuses to create an account with a handle another live account holds', async () => {
    const actor = await createActor('hosted-taken-create')
    const handle = pdsHandle('hosted-taken-create')
    await holdHandle('takencreateholder0000000', handle)

    await expect(
      createHostedBlueskyAccount({ database, actor, handle })
    ).rejects.toMatchObject({ code: 'HandleTaken', statusCode: 409 })
    expect(submissions).toHaveLength(0)
  })

  it('refuses to change to a handle another live account holds', async () => {
    const actor = await createActor('hosted-taken-change')
    await createHostedBlueskyAccount({
      database,
      actor,
      handle: pdsHandle('hosted-taken-change')
    })
    await holdHandle('takenchangeholder0000000', 'taken.example.com')
    submissions = []

    await expect(
      changeHostedBlueskyHandle({
        database,
        actor,
        handle: 'Taken.Example.com'
      })
    ).rejects.toMatchObject({
      code: 'HandleTaken',
      message: 'That handle is already used by another account on this server.'
    })
    expect(createBlueskyIdentityResolver).not.toHaveBeenCalled()
    expect(submissions).toHaveLength(0)
  })

  it('maps a lost race on the live-handle index to the same refusal', async () => {
    const actor = await createActor('hosted-taken-race')
    await createHostedBlueskyAccount({
      database,
      actor,
      handle: pdsHandle('hosted-taken-race')
    })
    const repo = await database.getPdsRepo({ actorId: actor.id })
    await holdHandle('takenraceholder000000000', 'race.example.com')
    vi.mocked(createBlueskyIdentityResolver).mockReturnValue({
      resolve: async () => ({ did: repo!.did })
    } as unknown as ReturnType<typeof createBlueskyIdentityResolver>)
    // The holder lands between the check and the write.
    const lookup = vi
      .spyOn(database, 'getPdsRepoByHandle')
      .mockResolvedValue(null)
    try {
      await expect(
        changeHostedBlueskyHandle({
          database,
          actor,
          handle: 'race.example.com'
        })
      ).rejects.toMatchObject({ code: 'HandleTaken' })

      const other = await createActor('hosted-taken-race2')
      await holdHandle(
        'takenraceholder200000000',
        pdsHandle('hosted-taken-race2')
      )
      await expect(
        createHostedBlueskyAccount({
          database,
          actor: other,
          handle: pdsHandle('hosted-taken-race2')
        })
      ).rejects.toMatchObject({ code: 'HandleTaken' })
    } finally {
      lookup.mockRestore()
    }
  })

  it('refuses a handle another domain’s live account holds before any PLC operation', async () => {
    const actor = await createActor('hosted-taken-crossdomain')
    await createHostedBlueskyAccount({
      database,
      actor,
      handle: pdsHandle('hosted-taken-crossdomain')
    })
    await database.createPdsRepo({
      did: 'did:plc:takencrossdomainholder00',
      actorId: 'https://other.example/users/holder',
      domain: 'other.example',
      signingKey: 'v1:key-crossdomain',
      signingKeyDid: 'did:key:zQ3shCrossDomain',
      handle: 'shared.example.com'
    })
    submissions = []

    await expect(
      changeHostedBlueskyHandle({
        database,
        actor,
        handle: 'shared.example.com'
      })
    ).rejects.toMatchObject({ code: 'HandleTaken' })
    expect(createBlueskyIdentityResolver).not.toHaveBeenCalled()
    expect(submissions).toHaveLength(0)
  })

  it('refuses a handle or recovery key change for a suspended or unapproved actor', async () => {
    const actor = await createActor('hosted-gate-blocked')
    const handle = pdsHandle('hosted-gate-blocked')
    await createHostedBlueskyAccount({ database, actor, handle })
    submissions = []

    for (const blocked of [
      { ...actor, suspendedAt: Date.now() },
      { ...actor, account: { ...actor.account!, approvedAt: null } }
    ]) {
      await expect(
        changeHostedBlueskyHandle({ database, actor: blocked, handle })
      ).rejects.toMatchObject({ code: 'PdsNotAllowed' })
      await expect(
        setHostedBlueskyRecoveryKey({
          database,
          actor: blocked,
          recoveryKeyDid: null
        })
      ).rejects.toMatchObject({ code: 'PdsNotAllowed' })
    }
    expect(submissions).toHaveLength(0)
  })

  it('appends the #account deleted event before the status flips', async () => {
    const actor = await createActor('hosted-delete-order')
    const handle = pdsHandle('hosted-delete-order')
    await createHostedBlueskyAccount({ database, actor, handle })
    const append = vi.spyOn(database, 'appendPdsEvent')
    const flip = vi.spyOn(database, 'updatePdsRepoStatus')
    try {
      await deleteHostedBlueskyAccount({
        database,
        actor,
        confirmHandle: handle
      })
      expect(append).toHaveBeenCalledTimes(1)
      expect(flip).toHaveBeenCalledTimes(1)
      expect(append.mock.invocationCallOrder[0]).toBeLessThan(
        flip.mock.invocationCallOrder[0]
      )
    } finally {
      append.mockRestore()
      flip.mockRestore()
    }
  })

  it('lets retention finish a delete that failed after the status flip, blob files included', async () => {
    const actor = await createActor('hosted-delete-partial')
    const handle = pdsHandle('hosted-delete-partial')
    await createHostedBlueskyAccount({ database, actor, handle })
    const repo = await database.getPdsRepo({ actorId: actor.id })
    const storageKey = `pds-blobs/${repo!.did}/bafkreipartial`
    await database.createPdsBlob({
      did: repo!.did,
      cid: 'bafkreipartial',
      mimeType: 'image/png',
      size: 1,
      storageKey
    })
    const removeContent = vi
      .spyOn(database, 'deletePdsRepoContent')
      .mockRejectedValueOnce(new Error('storage outage'))
    try {
      await expect(
        deleteHostedBlueskyAccount({ database, actor, confirmHandle: handle })
      ).rejects.toThrow('storage outage')
    } finally {
      removeContent.mockRestore()
    }
    expect((await database.getPdsRepo({ did: repo!.did }))?.status).toBe(
      'deleted'
    )
    expect(
      (await database.listPdsEvents({ did: repo!.did }))
        .map(decodePdsEvent)
        .at(-1)
    ).toMatchObject({ type: 'account', active: false, status: 'deleted' })
    vi.mocked(deletePdsBlobFilesBestEffort).mockClear()

    expect(
      await pruneDeletedPdsRepos(database, {
        now: Date.now() + 8 * 24 * 60 * 60 * 1000
      })
    ).toBeGreaterThanOrEqual(1)

    expect(await database.getPdsRepo({ did: repo!.did })).toBeNull()
    expect(await database.listPdsBlobStorageKeys({ did: repo!.did })).toEqual(
      []
    )
    expect(deletePdsBlobFilesBestEffort).toHaveBeenCalledWith([storageKey], {
      context: { did: repo!.did, reason: 'expired_pds_tombstone' }
    })
  })

  describe('the bare served domain as a handle', () => {
    const setRole = async (accountId: string, role: 'admin' | 'user') => {
      await testDb.db
        .updateTable('accounts')
        .set({ role })
        .where('id', '=', accountId)
        .execute()
    }
    const reload = async (username: string) =>
      (await database.getActorFromUsername({
        username,
        domain: TEST_DOMAIN
      }))!
    const makeAdmin = async (username: string) => {
      const actor = await createActor(username)
      await setRole(actor.account!.id, 'admin')
      return reload(username)
    }
    const link = (actorId: string, did: string) =>
      database.saveBlueskyAccount({
        actorId,
        did,
        handle: `${did.slice(8)}.bsky.social`,
        pdsUrl: 'https://bsky.social',
        authType: 'app_password',
        domainHandle: false
      })
    const choices = async (actor: Awaited<ReturnType<typeof makeAdmin>>) =>
      (await getHostedBlueskyAccountState({ database, actor })).handleChoices
    const atprotoDid = () =>
      getAtprotoDid(
        new NextRequest(`https://${TEST_DOMAIN}/.well-known/atproto-did`),
        { params: Promise.resolve({}) }
      )

    let adminA: Awaited<ReturnType<typeof makeAdmin>>
    let adminB: Awaited<ReturnType<typeof makeAdmin>>
    let adminC: Awaited<ReturnType<typeof makeAdmin>>

    beforeAll(async () => {
      routeDatabase.current = database
      // The route answers a hosted account only from a fresh snapshot.
      setServedDomainsForTests([])
      adminA = await makeAdmin('hosted-admin-a')
      adminB = await makeAdmin('hosted-admin-b')
      adminC = await makeAdmin('hosted-admin-c')
    })

    afterAll(() => {
      routeDatabase.current = null
      resetServedDomainsForTests()
    })

    it('is not offered to a profile that is not an admin’s', async () => {
      const actor = await createActor('hosted-plain')
      expect(
        (await choices(actor)).some((choice) => choice.kind === 'instance')
      ).toBe(false)
    })

    it('is not offered while another admin’s linked account claims it', async () => {
      await link(adminB.id, 'did:plc:bareclaimadminb')
      expect(
        await database.setBlueskyInstanceHandle({
          actorId: adminB.id,
          host: TEST_DOMAIN
        })
      ).toBe(true)

      expect(await choices(adminA)).toEqual([
        { handle: pdsHandle('hosted-admin-a'), kind: 'pds' }
      ])

      await database.setBlueskyInstanceHandle({
        actorId: adminB.id,
        host: null
      })
    })

    it('is offered to an admin, taken by a create and a change, and answered by atproto-did', async () => {
      expect(await choices(adminA)).toEqual([
        { handle: TEST_DOMAIN, kind: 'instance' },
        { handle: pdsHandle('hosted-admin-a'), kind: 'pds' }
      ])

      const state = await createHostedBlueskyAccount({
        database,
        actor: adminA,
        handle: TEST_DOMAIN
      })
      expect(state.repo?.handle).toBe(TEST_DOMAIN)
      const did = state.repo!.did

      let response = await atprotoDid()
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(did)

      // Its own repo keeps it on offer, so a change away and back is allowed.
      await changeHostedBlueskyHandle({
        database,
        actor: adminA,
        handle: pdsHandle('hosted-admin-a')
      })
      expect((await atprotoDid()).status).toBe(404)
      await changeHostedBlueskyHandle({
        database,
        actor: adminA,
        handle: TEST_DOMAIN
      })
      expect(createBlueskyIdentityResolver).not.toHaveBeenCalled()
      response = await atprotoDid()
      expect(await response.text()).toBe(did)
    })

    it('is not offered to another admin while a live hosted account holds it', async () => {
      expect(await choices(adminC)).toEqual([
        { handle: pdsHandle('hosted-admin-c'), kind: 'pds' }
      ])
    })

    it('refuses a linked account’s claim on a host a hosted account holds', async () => {
      await link(adminC.id, 'did:plc:bareclaimadminc')
      await expect(
        setBlueskyInstanceHandle(database, adminC, true)
      ).rejects.toMatchObject({ status: 409 })
      expect(
        (await database.getBlueskyAccount({ actorId: adminC.id }))
          ?.instanceHandle
      ).toBeNull()
    })

    it('stops answering for a hosted holder who is no longer an admin, and lets a current admin claim the host', async () => {
      await setRole(adminA.account!.id, 'user')
      const claimStatus = async (username: string) =>
        (await getBlueskyAccountState(database, await reload(username)))
          .instanceHandle?.status

      expect((await atprotoDid()).status).toBe(404)
      // An ineligible hosted holder decides nothing: the name is free.
      expect(await claimStatus('hosted-admin-b')).toBe('free')
      expect(await claimStatus('hosted-admin-c')).toBe('free')
      // The stale holder's row still holds the handle, so the hosted choice
      // stays off for others; the linked claim is open.
      expect(await choices(adminB)).toEqual([
        { handle: pdsHandle('hosted-admin-b'), kind: 'pds' }
      ])
      await setBlueskyInstanceHandle(database, adminC, true)

      const response = await atprotoDid()
      expect(await response.text()).toBe('did:plc:bareclaimadminc')
      expect(await claimStatus('hosted-admin-c')).toBe('yours')
      expect(await claimStatus('hosted-admin-b')).toBe('taken')
    })

    it('lets a reinstated hosted holder decide over a coexisting linked claim', async () => {
      await setRole(adminA.account!.id, 'admin')
      const repo = await database.getPdsRepo({ actorId: adminA.id })

      expect(await (await atprotoDid()).text()).toBe(repo!.did)
      const claim = await getBlueskyAccountState(
        database,
        await reload('hosted-admin-c')
      )
      // Not `yours`: the hosted account answers instead, and the claim can
      // be let go.
      expect(claim.instanceHandle).toMatchObject({
        host: TEST_DOMAIN,
        status: 'hosted'
      })
      // Another admin sees the name taken.
      expect(
        (await getBlueskyAccountState(database, await reload('hosted-admin-b')))
          .instanceHandle
      ).toMatchObject({ host: TEST_DOMAIN, status: 'taken' })

      // Turned off, it still decides the host: 404, not the claim.
      await deactivateHostedBlueskyAccount({
        database,
        actor: await reload('hosted-admin-a')
      })
      expect((await atprotoDid()).status).toBe(404)
    })

    it('never answers a suspended admin’s hosted DID for the bare domain', async () => {
      const repo = await database.getPdsRepo({ actorId: adminA.id })
      await database.applyModerationAction({
        targetActorId: adminA.id,
        accountId: adminA.account!.id,
        action: 'suspend',
        moderatorAccountId: 'moderator'
      })

      // A suspended holder may not hold the domain, so the current admin's
      // linked claim answers instead.
      const response = await atprotoDid()
      expect(await response.text()).not.toBe(repo!.did)
      expect(await (await atprotoDid()).text()).toBe('did:plc:bareclaimadminc')
    })
  })

  describe('the hosted account’s bluesky_accounts row', () => {
    it('is written on create, follows the handle, stays while off and goes on delete', async () => {
      const actor = await createActor('hosted-row')
      const handle = pdsHandle('hosted-row')
      const state = await createHostedBlueskyAccount({
        database,
        actor,
        handle
      })
      const did = state.repo!.did

      expect(
        await database.getBlueskyAccount({ actorId: actor.id })
      ).toMatchObject({
        did,
        handle,
        pdsUrl: `https://${PDS_HOSTNAME}`,
        authType: 'hosted',
        domainHandle: false,
        crosspostByDefault: false
      })
      // "Your Bluesky account" shows it as hosted, with no session to end and
      // no server-handle claim.
      expect(await getBlueskyAccountState(database, actor)).toMatchObject({
        account: { did, handle, authType: 'hosted', sessionActive: true },
        instanceHandle: null
      })

      vi.mocked(createBlueskyIdentityResolver).mockReturnValue({
        resolve: async () => ({ did })
      } as unknown as ReturnType<typeof createBlueskyIdentityResolver>)
      await changeHostedBlueskyHandle({
        database,
        actor,
        handle: 'row.example.com'
      })
      expect(
        (await database.getBlueskyAccount({ actorId: actor.id }))?.handle
      ).toBe('row.example.com')

      await database.updateBlueskyCrosspostDefault({
        actorId: actor.id,
        crosspostByDefault: true
      })
      await deactivateHostedBlueskyAccount({ database, actor })
      await reactivateHostedBlueskyAccount({ database, actor })
      expect(
        await database.getBlueskyAccount({ actorId: actor.id })
      ).toMatchObject({ did, authType: 'hosted', crosspostByDefault: true })

      await deleteHostedBlueskyAccount({
        database,
        actor,
        confirmHandle: 'row.example.com'
      })
      expect(await database.getBlueskyAccount({ actorId: actor.id })).toBeNull()
    })

    it('is written back for a hosted account that has none', async () => {
      const actor = await createActor('hosted-row-backfill')
      const handle = pdsHandle('hosted-row-backfill')
      const state = await createHostedBlueskyAccount({
        database,
        actor,
        handle
      })
      // An account created before the row existed.
      await database.deleteBlueskyAccount({ actorId: actor.id })

      await getHostedBlueskyAccountState({ database, actor })

      expect(
        await database.getBlueskyAccount({ actorId: actor.id })
      ).toMatchObject({
        did: state.repo!.did,
        handle,
        authType: 'hosted',
        crosspostByDefault: false
      })
    })

    it('keeps the hosted row when the status flip fails', async () => {
      const actor = await createActor('hosted-row-flipfail')
      const handle = pdsHandle('hosted-row-flipfail')
      const state = await createHostedBlueskyAccount({
        database,
        actor,
        handle
      })
      const updateStatus = vi
        .spyOn(database, 'updatePdsRepoStatus')
        .mockRejectedValueOnce(new Error('database offline'))
      try {
        await expect(
          deleteHostedBlueskyAccount({
            database,
            actor,
            confirmHandle: handle
          })
        ).rejects.toThrow('database offline')
      } finally {
        updateStatus.mockRestore()
      }

      // The account is still live, so its app state (row, follows,
      // interactions) must still be there.
      expect(
        await database.getBlueskyAccount({ actorId: actor.id })
      ).toMatchObject({ did: state.repo!.did, authType: 'hosted' })
      expect((await database.getPdsRepo({ actorId: actor.id }))?.status).toBe(
        'active'
      )
    })

    it('removes a hosted row a read wrote after the account was deleted', async () => {
      const actor = await createActor('hosted-row-orphan')
      const handle = pdsHandle('hosted-row-orphan')
      const state = await createHostedBlueskyAccount({
        database,
        actor,
        handle
      })
      await deleteHostedBlueskyAccount({
        database,
        actor,
        confirmHandle: handle
      })
      // A Settings read that saw the repo active and the row gone, racing the
      // delete, writes the row back after the delete removed it.
      await database.saveBlueskyAccount({
        actorId: actor.id,
        did: state.repo!.did,
        handle,
        pdsUrl: `https://${PDS_HOSTNAME}`,
        authType: 'hosted',
        domainHandle: false
      })

      await getHostedBlueskyAccountState({ database, actor })

      expect(await database.getBlueskyAccount({ actorId: actor.id })).toBeNull()
    })

    // An orphan hosted row of a deleted account, and a reconcile whose repo
    // read lets `meanwhile` write a new row between its row read and its
    // cleanup.
    const reconcileOrphanWhile = async (
      username: string,
      meanwhile: (actorId: string) => Promise<void>
    ) => {
      const actor = await createActor(username)
      const handle = pdsHandle(username)
      const state = await createHostedBlueskyAccount({
        database,
        actor,
        handle
      })
      await deleteHostedBlueskyAccount({
        database,
        actor,
        confirmHandle: handle
      })
      await database.saveBlueskyAccount({
        actorId: actor.id,
        did: state.repo!.did,
        handle,
        pdsUrl: `https://${PDS_HOSTNAME}`,
        authType: 'hosted',
        domainHandle: false
      })
      const getPdsRepo = database.getPdsRepo.bind(database)
      const spy = vi
        .spyOn(database, 'getPdsRepo')
        .mockImplementationOnce(async (params) => {
          const repo = await getPdsRepo(params)
          await meanwhile(actor.id)
          return repo
        })
      try {
        await getHostedBlueskyAccountState({ database, actor })
      } finally {
        spy.mockRestore()
      }
      return actor
    }

    it('keeps an outside link written after the orphan was read', async () => {
      const linkedDid = 'did:plc:linkedafterreadaaaaaaaaa'
      const actor = await reconcileOrphanWhile(
        'hosted-row-relinked',
        async (actorId) => {
          await database.deleteBlueskyAccount({ actorId })
          await database.saveBlueskyAccount({
            actorId,
            did: linkedDid,
            handle: 'alice.bsky.social',
            pdsUrl: 'https://bsky.social',
            authType: 'oauth',
            domainHandle: false
          })
          await database.setBlueskySession({ did: linkedDid, session: 's' })
        }
      )

      expect(
        await database.getBlueskyAccount({ actorId: actor.id })
      ).toMatchObject({ did: linkedDid, authType: 'oauth' })
      expect(await database.getBlueskySession({ did: linkedDid })).toBe('s')
    })

    it('keeps a new hosted account’s row written after the orphan was read', async () => {
      const newDid = 'did:plc:newhostedafterreadaaaaaa'
      const actor = await reconcileOrphanWhile(
        'hosted-row-recreated',
        async (actorId) => {
          await database.saveBlueskyAccount({
            actorId,
            did: newDid,
            handle: 'new.example.com',
            pdsUrl: `https://${PDS_HOSTNAME}`,
            authType: 'hosted',
            domainHandle: false
          })
        }
      )

      expect(
        await database.getBlueskyAccount({ actorId: actor.id })
      ).toMatchObject({ did: newDid, authType: 'hosted' })
    })

    it('writes no row once a delete lands between the read and the write', async () => {
      const actor = await createActor('hosted-row-race')
      const handle = pdsHandle('hosted-row-race')
      const state = await createHostedBlueskyAccount({
        database,
        actor,
        handle
      })
      const did = state.repo!.did
      await database.deleteBlueskyAccount({ actorId: actor.id })
      // The delete takes the repo lock first and tombstones the repo.
      const realLock = vi.mocked(withPdsRepoLock).getMockImplementation()!
      vi.mocked(withPdsRepoLock).mockImplementationOnce(
        async (db, key, fn, options) => {
          await database.updatePdsRepoStatus({ did, status: 'deleted' })
          return realLock(db, key, fn, options)
        }
      )

      await getHostedBlueskyAccountState({ database, actor })

      expect(await database.getBlueskyAccount({ actorId: actor.id })).toBeNull()
    })

    it('does not stop a new account when the old one left its hosted row', async () => {
      const actor = await createActor('hosted-row-stale')
      await database.saveBlueskyAccount({
        actorId: actor.id,
        did: 'did:plc:stalehostedrowaaaaaaaaaa',
        handle: 'old.example.com',
        pdsUrl: `https://${PDS_HOSTNAME}`,
        authType: 'hosted',
        domainHandle: false
      })

      const state = await createHostedBlueskyAccount({
        database,
        actor,
        handle: pdsHandle('hosted-row-stale')
      })

      expect(
        await database.getBlueskyAccount({ actorId: actor.id })
      ).toMatchObject({ did: state.repo!.did, authType: 'hosted' })
    })

    it('is never unlinked, relinked or claimed from "Your Bluesky account"', async () => {
      const actor = await createActor('hosted-row-guard')
      const handle = pdsHandle('hosted-row-guard')
      const state = await createHostedBlueskyAccount({
        database,
        actor,
        handle
      })
      const hostedMessage =
        'Your Bluesky account is hosted on this server. Manage it under “Host my Bluesky account here”.'

      await expect(unlinkBluesky(database, actor)).rejects.toThrow(
        hostedMessage
      )
      await expect(checkBlueskyHandle(database, actor)).rejects.toThrow(
        hostedMessage
      )
      await expect(
        setBlueskyInstanceHandle(database, actor, true)
      ).rejects.toBeInstanceOf(BlueskyLinkError)
      await expect(
        linkBlueskyAppPassword(database, actor, {
          identifier: 'alice.bsky.social',
          password: 'abcd-efgh-ijkl-mnop'
        })
      ).rejects.toThrow(/hosted on this server/)
      await expect(
        startBlueskyOAuth(database, actor, 'alice.bsky.social')
      ).rejects.toThrow(/hosted on this server/)

      // A second create is still refused as an existing account.
      await expect(
        createHostedBlueskyAccount({ database, actor, handle })
      ).rejects.toMatchObject({ code: 'HostedAccountExists' })
      expect(
        await database.getBlueskyAccount({ actorId: actor.id })
      ).toMatchObject({ did: state.repo!.did, authType: 'hosted' })
    })
  })

  describe('move guards', () => {
    const movedOperation = JSON.stringify({
      type: 'plc_operation',
      services: {
        atproto_pds: {
          type: 'AtprotoPersonalDataServer',
          endpoint: 'https://dest.pds.example'
        }
      }
    })

    it('refuses deactivate, handle change and recovery key changes on a moved repo', async () => {
      const actor = await createActor('hosted-moved-guard')
      const handle = pdsHandle('hosted-moved-guard')
      const state = await createHostedBlueskyAccount({
        database,
        actor,
        handle
      })
      await database.updatePdsRepoIdentity({
        did: state.repo!.did,
        plcOperation: movedOperation
      })

      await expect(
        deactivateHostedBlueskyAccount({ database, actor })
      ).rejects.toBeInstanceOf(PdsAccountMovedError)
      await expect(
        changeHostedBlueskyHandle({ database, actor, handle })
      ).rejects.toBeInstanceOf(PdsAccountMovedError)
      await expect(
        setHostedBlueskyRecoveryKey({
          database,
          actor,
          recoveryKeyDid: null
        })
      ).rejects.toBeInstanceOf(PdsAccountMovedError)
    })

    it('refuses deactivate, handle change, recovery key and delete while a move is stored', async () => {
      const actor = await createActor('hosted-move-pending')
      const handle = pdsHandle('hosted-move-pending')
      const state = await createHostedBlueskyAccount({
        database,
        actor,
        handle
      })
      await writeStoredBlueskySession(database, state.repo!.did, {
        type: 'move-out',
        pdsUrl: 'https://dest.pds.example',
        destDid: 'did:web:dest.pds.example',
        handle: 'alice.dest.pds.example',
        accessJwt: 'a',
        refreshJwt: 'r',
        importedRev: null,
        switchedAt: null
      })

      await expect(
        deactivateHostedBlueskyAccount({ database, actor })
      ).rejects.toBeInstanceOf(PdsMoveOutPendingError)
      await expect(
        changeHostedBlueskyHandle({
          database,
          actor,
          handle: `${handle}-x`
        })
      ).rejects.toBeInstanceOf(PdsMoveOutPendingError)
      await expect(
        setHostedBlueskyRecoveryKey({
          database,
          actor,
          recoveryKeyDid: null
        })
      ).rejects.toBeInstanceOf(PdsMoveOutPendingError)
      await expect(
        deleteHostedBlueskyAccount({ database, actor, confirmHandle: handle })
      ).rejects.toBeInstanceOf(PdsMoveOutPendingError)
    })
  })
})
