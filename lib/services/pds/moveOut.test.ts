import { Secp256k1Keypair, verifySignature } from '@atproto/crypto'
import { Readable } from 'node:stream'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { getBlueskyAgent } from '@/lib/services/bluesky/agent'
import {
  deleteStoredBlueskySession,
  readStoredBlueskySession,
  writeStoredBlueskySession
} from '@/lib/services/bluesky/client'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { logger } from '@/lib/utils/logger'
import {
  SafeRemoteFetchError,
  type SafeRemoteFetchOptions,
  safeRemoteFetch
} from '@/lib/utils/safeRemoteFetch'

import {
  createHostedBlueskyAccount,
  deactivateHostedBlueskyAccount,
  deleteHostedBlueskyAccount,
  getHostedBlueskyAccountState,
  reactivateHostedBlueskyAccount,
  setHostedBlueskyRecoveryKey
} from './accounts'
import type { PdsBlobObjectStore } from './blobStorage'
import { uploadPdsBlob } from './blobs'
import {
  PdsAccountMovedError,
  PdsDisabledError,
  PdsHostedAccountInactiveError,
  PdsHostedRateLimitedError,
  PdsMoveOutInProgressError,
  PdsMoveOutInvalidCredentialsError,
  PdsMoveOutInvalidServerUrlError,
  PdsMoveOutNotFoundError,
  PdsMoveOutRemoteError,
  PdsMoveOutSwitchedError,
  PdsValidationError
} from './errors'
import { decodePdsEvent } from './events'
import {
  cancelMoveOut,
  copyMoveOutBlobs,
  copyMoveOutPreferences,
  finishMoveOut,
  getMoveOutProgress,
  sendMoveOutRepo,
  startMoveOut
} from './moveOut'
import {
  type PlcSignedOperation,
  cidForOperation,
  verifyPlcOperationSignature
} from './plc'
import { createPdsRecord } from './repo'

vi.mock('@/lib/utils/safeRemoteFetch', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/utils/safeRemoteFetch')>()
  return {
    ...actual,
    safeRemoteFetch: vi.fn()
  }
})

const ROTATION_KEY_HEX =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const PDS_HOSTNAME = `pds.${TEST_DOMAIN}`
const PLC_DIRECTORY = 'https://plc.directory'
const DEST_PDS = 'https://dest.pds.example'
const DEST_HOST = 'dest.pds.example'
const DEST_DID = 'did:web:dest.pds.example'

const ALLOWED_USERNAMES = [
  'move-url',
  'move-redirect',
  'move-password',
  'move-duplicate',
  'move-ratelimit',
  'move-refresh',
  'move-copy',
  'move-blobs',
  'move-prefs',
  'move-creds',
  'move-full-recovery',
  'move-full-norecovery',
  'move-retry',
  'move-cancel',
  'move-revchange',
  'move-isolation',
  'move-blob-remote-fail',
  'move-retry-plc-only',
  'move-delete-keeps-link',
  'move-dest-did',
  'move-blob-bounds',
  'move-retry-active',
  'move-retry-event',
  'move-refresh-cancel',
  'move-rotation-dir',
  'move-cancel-switched',
  'move-handle-mismatch',
  'move-blob-read-error',
  'move-inactive',
  'move-invalid-email',
  'move-create-did',
  'move-domain-gate',
  'move-config-gone',
  'move-not-allowlisted',
  'move-stage-plc',
  'move-post-switch-blobs',
  'move-finish-catch-up',
  'move-retry-takendown',
  'move-post-switch-missing',
  'move-delete-switched',
  'move-delete-unrecorded',
  'move-cancel-no-key',
  'move-cancel-no-config',
  'move-cancel-no-config-away',
  'move-blob-budget',
  'move-finish-budget',
  'move-finish-stuck',
  'move-finish-stuck-full',
  'move-finish-list-fails',
  'move-finish-list-bad',
  'move-finish-list-429',
  'move-stale-actor',
  'move-not-copied',
  'move-cancel-rotated',
  'move-entryway',
  'move-catch-up-unreachable',
  'move-catch-up-unreachable-body',
  'move-stage-entryway'
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

// What a destination answers for a call a test does not care about: nothing
// missing, so finish's catch-up copy ends at once.
const defaultDestBody = (url: string) =>
  url.includes('/com.atproto.repo.listMissingBlobs') ? '{"blobs":[]}' : '{}'

const okResponse = (url: string, body = '', statusCode = 200) => ({
  body,
  bodyTruncated: false,
  headers: {},
  statusCode,
  url
})

const createMemoryBlobStore = (): PdsBlobObjectStore => {
  const files = new Map<string, Buffer>()
  return {
    put: async (key, bytes) => {
      files.set(key, Buffer.from(bytes))
    },
    openRead: async (key) => {
      const bytes = files.get(key)
      return bytes ? Readable.from([bytes]) : null
    },
    delete: async (key) => {
      files.delete(key)
    }
  }
}

describe('hosted Bluesky account move-out', () => {
  const testDb = createTestDatabase()
  const { database } = testDb

  let originalPdsEnv: string | undefined
  let originalRotationKey: string | undefined
  let originalPlcUrl: string | undefined
  let plcOpsByDid: Map<string, PlcSignedOperation[]>
  let fetchCalls: SafeRemoteFetchOptions[]
  let destHandler: (
    options: SafeRemoteFetchOptions
  ) => Promise<ReturnType<typeof okResponse>> | ReturnType<typeof okResponse>

  const serverRotationKeypair = () =>
    Secp256k1Keypair.import(Buffer.from(ROTATION_KEY_HEX, 'hex'))

  const createActor = async (username: string) => {
    await database.createAccount({
      email: `${username}@${TEST_DOMAIN}`,
      username,
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: `private-key-${username}`,
      publicKey: `public-key-${username}`
    })
    const actor = await database.getActorFromUsername({
      username,
      domain: TEST_DOMAIN
    })
    if (!actor) throw new Error(`Missing actor ${username}`)
    return actor
  }

  const setupHostedAccount = async (username: string) => {
    const actor = await createActor(username)
    const handle = `${username}.${PDS_HOSTNAME}`
    const state = await createHostedBlueskyAccount({ database, actor, handle })
    if (!state.repo) throw new Error('Expected hosted repo')
    return { actor, did: state.repo.did, handle }
  }

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    originalPdsEnv = process.env.ACTIVITIES_BLUESKY_PDS
    originalRotationKey = process.env.ACTIVITIES_BLUESKY_PDS_ROTATION_KEY
    originalPlcUrl = process.env.ACTIVITIES_BLUESKY_PLC_DIRECTORY_URL
    process.env.ACTIVITIES_BLUESKY_PDS = ENABLED_PDS_ENV
    process.env.ACTIVITIES_BLUESKY_PDS_ROTATION_KEY = ROTATION_KEY_HEX
    process.env.ACTIVITIES_BLUESKY_PLC_DIRECTORY_URL = PLC_DIRECTORY

    plcOpsByDid = new Map()
    fetchCalls = []
    destHandler = (options) =>
      okResponse(options.url, JSON.stringify({ error: 'Unhandled' }), 500)

    vi.mocked(safeRemoteFetch).mockReset()
    vi.mocked(safeRemoteFetch).mockImplementation(async (options) => {
      fetchCalls.push(options)
      const parsed = new URL(options.url)
      if (parsed.origin === PLC_DIRECTORY) {
        if (options.method === 'POST') {
          const did = parsed.pathname.slice(1)
          const op = JSON.parse(options.body ?? '{}') as PlcSignedOperation
          const existing = plcOpsByDid.get(did) ?? []
          existing.push(op)
          plcOpsByDid.set(did, existing)
          return okResponse(options.url, '')
        }
        if (options.method === 'GET' && parsed.pathname.endsWith('/log/last')) {
          const did = parsed.pathname.slice(1, -'/log/last'.length)
          const existing = plcOpsByDid.get(did) ?? []
          const last = existing[existing.length - 1]
          if (!last) return okResponse(options.url, 'not found', 404)
          return okResponse(options.url, JSON.stringify(last))
        }
      }
      return destHandler(options)
    })
  })

  afterEach(() => {
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
    if (originalPlcUrl === undefined) {
      delete process.env.ACTIVITIES_BLUESKY_PLC_DIRECTORY_URL
    } else {
      process.env.ACTIVITIES_BLUESKY_PLC_DIRECTORY_URL = originalPlcUrl
    }
    vi.restoreAllMocks()
  })

  it('refuses non-https, path/query/credential, and own-PDS URLs before fetching', async () => {
    const { actor } = await setupHostedAccount('move-url')
    fetchCalls.length = 0

    for (const badUrl of [
      'http://dest.pds.example',
      'https://dest.pds.example/xrpc',
      'https://dest.pds.example?foo=bar',
      'https://dest.pds.example#frag',
      'https://user:pass@dest.pds.example',
      'not-a-url',
      `https://${PDS_HOSTNAME}`,
      `https://${PDS_HOSTNAME}:8443`
    ]) {
      await expect(
        startMoveOut({
          database,
          actor,
          pdsUrl: badUrl,
          handle: 'alice.dest.pds.example',
          email: 'alice@example.com',
          password: 'new-account-password'
        })
      ).rejects.toBeInstanceOf(PdsMoveOutInvalidServerUrlError)
    }

    expect(fetchCalls).toHaveLength(0)

    // Also refuses if describeServer returns this server's own PDS DID.
    destHandler = (options) =>
      okResponse(
        options.url,
        JSON.stringify({ did: `did:web:${PDS_HOSTNAME}` })
      )
    await expect(
      startMoveOut({
        database,
        actor,
        pdsUrl: DEST_PDS,
        handle: 'alice.dest.pds.example',
        email: 'alice@example.com',
        password: 'new-account-password'
      })
    ).rejects.toBeInstanceOf(PdsMoveOutInvalidServerUrlError)
  })

  it('calls safeRemoteFetch with maxRedirects: 0 and refuses redirects', async () => {
    const { actor } = await setupHostedAccount('move-redirect')
    fetchCalls.length = 0

    destHandler = () => {
      throw new SafeRemoteFetchError(
        'Too many redirects',
        'ERR_TOO_MANY_REDIRECTS'
      )
    }

    await expect(
      startMoveOut({
        database,
        actor,
        pdsUrl: DEST_PDS,
        handle: 'alice.dest.pds.example',
        email: 'alice@example.com',
        password: 'secret-password'
      })
    ).rejects.toMatchObject({
      code: 'MoveOutRemoteError',
      statusCode: 502,
      message: expect.stringContaining('redirect')
    })

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]).toMatchObject({
      url: `${DEST_PDS}/xrpc/com.atproto.server.describeServer`,
      maxRedirects: 0,
      allowCrossHostRedirects: false
    })
  })

  it('sends password only to createAccount with valid service-auth JWT and never stores, logs, or echoes it', async () => {
    const { actor, did } = await setupHostedAccount('move-password')
    const repo = await database.getPdsRepo({ did })
    const secretPassword = 'UltraSecretMovePassword!99'

    const infoSpy = vi.spyOn(logger, 'info')
    const warnSpy = vi.spyOn(logger, 'warn')
    const errorSpy = vi.spyOn(logger, 'error')

    // First, test that a remote error echoing the password is redacted.
    destHandler = (options) => {
      if (options.url.endsWith('/com.atproto.server.describeServer')) {
        return okResponse(options.url, JSON.stringify({ did: DEST_DID }))
      }
      return okResponse(
        options.url,
        JSON.stringify({
          error: 'InvalidPassword',
          message: `Rejected password ${secretPassword} for account`
        }),
        400
      )
    }

    let caughtError: unknown
    try {
      await startMoveOut({
        database,
        actor,
        pdsUrl: DEST_PDS,
        handle: 'alice.dest.pds.example',
        email: 'alice@example.com',
        password: secretPassword
      })
    } catch (error) {
      caughtError = error
    }
    expect(caughtError).toBeInstanceOf(PdsMoveOutRemoteError)
    expect((caughtError as Error).message).not.toContain(secretPassword)
    expect(JSON.stringify(caughtError)).not.toContain(secretPassword)

    // Now succeed and verify service-auth JWT, storage, logs, and return value.
    let createAuthHeader = ''
    let createBody = ''
    destHandler = (options) => {
      if (options.url.endsWith('/com.atproto.server.describeServer')) {
        return okResponse(options.url, JSON.stringify({ did: DEST_DID }))
      }
      if (options.url.endsWith('/com.atproto.server.createAccount')) {
        const headers = options.headers as Record<string, string>
        createAuthHeader = headers.Authorization ?? ''
        createBody = options.body ?? ''
        return okResponse(
          options.url,
          JSON.stringify({
            did,
            handle: 'alice.dest.pds.example',
            accessJwt: 'dest-access-jwt',
            refreshJwt: 'dest-refresh-jwt'
          })
        )
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    fetchCalls.length = 0
    const started = await startMoveOut({
      database,
      actor,
      pdsUrl: `${DEST_PDS}/`,
      handle: 'Alice.Dest.Pds.Example',
      email: 'alice@example.com',
      password: secretPassword,
      inviteCode: 'invite-123'
    })

    // Service-auth JWT is ES256K signed by the repo's signing key.
    expect(createAuthHeader.startsWith('Bearer ')).toBe(true)
    const token = createAuthHeader.slice('Bearer '.length)
    const [encodedHeader, encodedPayload, encodedSig] = token.split('.')
    const jwtHeader = JSON.parse(
      Buffer.from(encodedHeader, 'base64url').toString('utf8')
    )
    const jwtPayload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    )
    expect(jwtHeader).toEqual({ typ: 'JWT', alg: 'ES256K' })
    expect(jwtPayload).toMatchObject({
      iss: did,
      aud: DEST_DID,
      lxm: 'com.atproto.server.createAccount'
    })
    expect(
      await verifySignature(
        repo!.signingKeyDid,
        Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
        Buffer.from(encodedSig, 'base64url')
      )
    ).toBe(true)

    // Password sent only to createAccount.
    expect(JSON.parse(createBody)).toEqual({
      did,
      handle: 'alice.dest.pds.example',
      email: 'alice@example.com',
      password: secretPassword,
      inviteCode: 'invite-123'
    })

    // Password and tokens never appear in return value, stored session, or logs.
    expect(JSON.stringify(started)).not.toContain(secretPassword)
    expect(JSON.stringify(started)).not.toContain('dest-access-jwt')
    expect(JSON.stringify(started)).not.toContain('dest-refresh-jwt')

    const rawSession = await database.getBlueskySession({ did })
    expect(rawSession).not.toBeNull()
    expect(rawSession).not.toContain(secretPassword)
    expect(rawSession).not.toContain('dest-access-jwt')

    const decryptedSession = await readStoredBlueskySession(database, did)
    expect(decryptedSession).toEqual({
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'alice.dest.pds.example',
      accessJwt: 'dest-access-jwt',
      refreshJwt: 'dest-refresh-jwt',
      importedRev: null,
      switchedAt: null
    })
    expect(JSON.stringify(decryptedSession)).not.toContain(secretPassword)

    const allLogs = JSON.stringify([
      ...infoSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls
    ])
    expect(allLogs).not.toContain(secretPassword)
    expect(allLogs).not.toContain('dest-access-jwt')
    expect(allLogs).not.toContain('dest-refresh-jwt')

    // Every remote request went to the normalized https origin with maxRedirects: 0.
    for (const call of fetchCalls) {
      expect(new URL(call.url).origin).toBe(DEST_PDS)
      expect(call.maxRedirects).toBe(0)
    }
  })

  it('refuses starting a second move while one is already in progress, and enforces the 3/day move rate limit', async () => {
    const { actor, did } = await setupHostedAccount('move-ratelimit')
    destHandler = (options) => {
      if (options.url.endsWith('/com.atproto.server.describeServer')) {
        return okResponse(options.url, JSON.stringify({ did: DEST_DID }))
      }
      if (options.url.endsWith('/com.atproto.server.createAccount')) {
        return okResponse(
          options.url,
          JSON.stringify({
            did,
            handle: 'alice.dest.pds.example',
            accessJwt: 'a1',
            refreshJwt: 'r1'
          })
        )
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    await startMoveOut({
      database,
      actor,
      pdsUrl: DEST_PDS,
      handle: 'alice.dest.pds.example',
      email: 'alice@example.com',
      password: 'pw1'
    })

    // Duplicate move refused with 409.
    await expect(
      startMoveOut({
        database,
        actor,
        pdsUrl: DEST_PDS,
        handle: 'alice.dest.pds.example',
        email: 'alice@example.com',
        password: 'pw1'
      })
    ).rejects.toBeInstanceOf(PdsMoveOutInProgressError)

    // Cancel and retry twice more to exhaust the 3/day budget.
    await cancelMoveOut({ database, actor })
    for (let i = 0; i < 2; i += 1) {
      await startMoveOut({
        database,
        actor,
        pdsUrl: DEST_PDS,
        handle: 'alice.dest.pds.example',
        email: 'alice@example.com',
        password: 'pw1'
      })
      await cancelMoveOut({ database, actor })
    }

    await expect(
      startMoveOut({
        database,
        actor,
        pdsUrl: DEST_PDS,
        handle: 'alice.dest.pds.example',
        email: 'alice@example.com',
        password: 'pw1'
      })
    ).rejects.toBeInstanceOf(PdsHostedRateLimitedError)
  })

  it('refreshes tokens once on 400/401 ExpiredToken and persists the new tokens', async () => {
    const { actor, did } = await setupHostedAccount('move-refresh')
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'alice.dest.pds.example',
      accessJwt: 'expired-access',
      refreshJwt: 'initial-refresh',
      importedRev: null,
      switchedAt: null
    })

    let statusCalls = 0
    let refreshAuth = ''
    destHandler = (options) => {
      const headers = options.headers as Record<string, string>
      if (options.url.endsWith('/com.atproto.server.checkAccountStatus')) {
        statusCalls += 1
        if (headers.Authorization === 'Bearer expired-access') {
          return okResponse(
            options.url,
            JSON.stringify({ error: 'ExpiredToken', message: 'Token expired' }),
            401
          )
        }
        expect(headers.Authorization).toBe('Bearer fresh-access')
        return okResponse(
          options.url,
          JSON.stringify({
            activated: false,
            validDid: false,
            repoCommit: 'bafycommit',
            repoRev: '3krev',
            repoBlocks: 4,
            indexedRecords: 2,
            privateStateValues: 0,
            expectedBlobs: 1,
            importedBlobs: 1
          })
        )
      }
      if (options.url.endsWith('/com.atproto.server.refreshSession')) {
        refreshAuth = headers.Authorization ?? ''
        return okResponse(
          options.url,
          JSON.stringify({
            did,
            accessJwt: 'fresh-access',
            refreshJwt: 'fresh-refresh'
          })
        )
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    const progress = await getMoveOutProgress({ database, actor })
    expect(statusCalls).toBe(2)
    expect(refreshAuth).toBe('Bearer initial-refresh')
    expect(progress).toMatchObject({
      pdsUrl: DEST_PDS,
      handle: 'alice.dest.pds.example',
      stage: 'started',
      status: {
        repoRev: '3krev',
        indexedRecords: 2,
        expectedBlobs: 1,
        importedBlobs: 1
      }
    })
    expect(JSON.stringify(progress)).not.toContain('fresh-access')
    expect(JSON.stringify(progress)).not.toContain('fresh-refresh')

    expect(await readStoredBlueskySession(database, did)).toMatchObject({
      type: 'move-out',
      accessJwt: 'fresh-access',
      refreshJwt: 'fresh-refresh'
    })
  })

  it('copies repo CAR, blobs in resumable batches with per-blob failure tolerance, and preferences repeatably', async () => {
    const { actor, did } = await setupHostedAccount('move-blobs')
    const store = createMemoryBlobStore()

    const blob1 = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('image-one-bytes'), mimeType: 'image/png' },
      { store }
    )
    const blob2 = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('image-two-bytes'), mimeType: 'image/jpeg' },
      { store }
    )
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'hello with images',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [
            { alt: 'one', image: blob1.blob },
            { alt: 'two', image: blob2.blob }
          ]
        }
      }
    })
    await database.putPdsPreferences({
      did,
      preferences: [
        { $type: 'app.bsky.actor.defs#adultContentPref', enabled: false }
      ]
    })

    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'alice.dest.pds.example',
      accessJwt: 'access-1',
      refreshJwt: 'refresh-1',
      importedRev: null,
      switchedAt: null
    })

    const uploadedBlobs: Array<{ mimeType: string; bytes: string }> = []
    const importedCars: number[] = []
    let receivedPrefs: unknown = null
    let blobUploadAttempt = 0

    destHandler = (options) => {
      const headers = options.headers as Record<string, string>
      if (options.url.endsWith('/com.atproto.repo.importRepo')) {
        expect(headers['Content-Type']).toBe('application/vnd.ipld.car')
        expect(options.bodyBytes).toBeInstanceOf(Uint8Array)
        importedCars.push(options.bodyBytes!.byteLength)
        return okResponse(options.url, '')
      }
      if (options.url.includes('/com.atproto.repo.listMissingBlobs')) {
        const parsed = new URL(options.url)
        const cursor = parsed.searchParams.get('cursor')
        if (!cursor) {
          return okResponse(
            options.url,
            JSON.stringify({
              cursor: 'page-2',
              blobs: [
                {
                  cid: blob1.cid,
                  recordUri: `at://${did}/app.bsky.feed.post/1`
                },
                // Duplicate CID in same batch should not upload twice.
                {
                  cid: blob1.cid,
                  recordUri: `at://${did}/app.bsky.feed.post/2`
                },
                {
                  cid: 'bafkreimissinglocalblobcid00000000000000000000000000000000',
                  recordUri: `at://${did}/app.bsky.feed.post/3`
                }
              ]
            })
          )
        }
        return okResponse(
          options.url,
          JSON.stringify({
            blobs: [
              { cid: blob2.cid, recordUri: `at://${did}/app.bsky.feed.post/1` }
            ]
          })
        )
      }
      if (options.url.endsWith('/com.atproto.repo.uploadBlob')) {
        blobUploadAttempt += 1
        uploadedBlobs.push({
          mimeType: headers['Content-Type'] ?? '',
          bytes: Buffer.from(options.bodyBytes ?? []).toString('utf8')
        })
        return okResponse(
          options.url,
          JSON.stringify({ blob: { $type: 'blob' } })
        )
      }
      if (options.url.endsWith('/app.bsky.actor.putPreferences')) {
        receivedPrefs = JSON.parse(options.body ?? '{}')
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    // Repo copy can be repeated without error or duplication.
    const repo1 = await sendMoveOutRepo({ database, actor })
    const repo2 = await sendMoveOutRepo({ database, actor })
    expect(repo1.bytes).toBeGreaterThan(0)
    expect(repo2.importedRev).toBe(repo1.importedRev)
    expect(importedCars).toHaveLength(2)

    // Batch 1: blob1 succeeds (uploaded once despite duplicate entry), missing blob fails without stopping batch.
    const batch1 = await copyMoveOutBlobs({ database, actor, limit: 10, store })
    expect(batch1).toEqual({
      copied: 1,
      failed: [
        {
          cid: 'bafkreimissinglocalblobcid00000000000000000000000000000000',
          reason: 'Blob not found on this server.'
        }
      ],
      cursor: 'page-2',
      done: false
    })
    expect(blobUploadAttempt).toBe(1)

    // Batch 2 with cursor finishes cleanly.
    const batch2 = await copyMoveOutBlobs({
      database,
      actor,
      cursor: batch1.cursor!,
      limit: 10,
      store
    })
    expect(batch2).toEqual({
      copied: 1,
      failed: [],
      cursor: null,
      done: true
    })
    expect(uploadedBlobs).toEqual([
      { mimeType: 'image/png', bytes: 'image-one-bytes' },
      { mimeType: 'image/jpeg', bytes: 'image-two-bytes' }
    ])

    // Preferences copy is repeatable.
    const prefRes1 = await copyMoveOutPreferences({ database, actor })
    const prefRes2 = await copyMoveOutPreferences({ database, actor })
    expect(prefRes1).toEqual({ count: 1 })
    expect(prefRes2).toEqual({ count: 1 })
    expect(receivedPrefs).toEqual({
      preferences: [
        { $type: 'app.bsky.actor.defs#adultContentPref', enabled: false }
      ]
    })

    // importRepo, listMissingBlobs, uploadBlob and putPreferences all went to
    // the stored destination origin.
    for (const call of fetchCalls) {
      const origin = new URL(call.url).origin
      if (origin === PLC_DIRECTORY) continue
      expect(origin).toBe(DEST_PDS)
    }
  })

  it('refuses invalid recommended DID credentials without submitting a PLC op', async () => {
    const { actor, did } = await setupHostedAccount('move-creds')
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotationKey = await Secp256k1Keypair.create()
    const serverKey = await serverRotationKeypair()

    const currentRepo = await database.getPdsRepo({ did })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'alice.dest.pds.example',
      accessJwt: 'access-1',
      refreshJwt: 'refresh-1',
      importedRev: currentRepo!.rev,
      switchedAt: null
    })

    const badCredentialsList = [
      // This server's own PDS hostname
      {
        services: {
          atproto_pds: {
            type: 'AtprotoPersonalDataServer',
            endpoint: `https://${PDS_HOSTNAME}`
          }
        },
        verificationMethods: { atproto: destSigningKey.did() },
        alsoKnownAs: ['at://alice.dest.pds.example'],
        rotationKeys: [destRotationKey.did()]
      },
      // The same host written as a fully qualified name
      {
        services: {
          atproto_pds: {
            type: 'AtprotoPersonalDataServer',
            endpoint: `https://${PDS_HOSTNAME}.`
          }
        },
        verificationMethods: { atproto: destSigningKey.did() },
        alsoKnownAs: ['at://alice.dest.pds.example'],
        rotationKeys: [destRotationKey.did()]
      },
      // Invalid signing key
      {
        services: {
          atproto_pds: {
            type: 'AtprotoPersonalDataServer',
            endpoint: DEST_PDS
          }
        },
        verificationMethods: { atproto: 'not-a-did-key' },
        alsoKnownAs: ['at://alice.dest.pds.example'],
        rotationKeys: [destRotationKey.did()]
      },
      // Wrong handle in alsoKnownAs
      {
        services: {
          atproto_pds: {
            type: 'AtprotoPersonalDataServer',
            endpoint: DEST_PDS
          }
        },
        verificationMethods: { atproto: destSigningKey.did() },
        alsoKnownAs: ['at://someone-else.example'],
        rotationKeys: [destRotationKey.did()]
      },
      // Only this server's rotation key (leaving none after removal)
      {
        services: {
          atproto_pds: {
            type: 'AtprotoPersonalDataServer',
            endpoint: DEST_PDS
          }
        },
        verificationMethods: { atproto: destSigningKey.did() },
        alsoKnownAs: ['at://alice.dest.pds.example'],
        rotationKeys: [serverKey.did()]
      }
    ]

    const plcOpsBefore = plcOpsByDid.get(did)?.length ?? 0

    for (const badCreds of badCredentialsList) {
      destHandler = (options) => {
        if (
          options.url.endsWith(
            '/com.atproto.identity.getRecommendedDidCredentials'
          )
        ) {
          return okResponse(options.url, JSON.stringify(badCreds))
        }
        return okResponse(options.url, '')
      }

      await expect(finishMoveOut({ database, actor })).rejects.toBeInstanceOf(
        PdsMoveOutInvalidCredentialsError
      )
    }

    expect(plcOpsByDid.get(did)?.length ?? 0).toBe(plcOpsBefore)
  })

  it('completes move with recovery key first, drops server rotation key, re-sends changed repo, emits events, blocks reactivation, and deletes moved copy cleanly', async () => {
    const { actor, did, handle } =
      await setupHostedAccount('move-full-recovery')
    const recoveryKey = await Secp256k1Keypair.create()
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey1 = await Secp256k1Keypair.create()
    const destRotKey2 = await Secp256k1Keypair.create()
    const serverKey = await serverRotationKeypair()

    await setHostedBlueskyRecoveryKey({
      database,
      actor,
      recoveryKeyDid: recoveryKey.did()
    })

    let importRepoCount = 0
    let activateCount = 0
    let deleteSessionCalls = 0

    destHandler = (options) => {
      if (options.url.endsWith('/com.atproto.server.describeServer')) {
        return okResponse(options.url, JSON.stringify({ did: DEST_DID }))
      }
      if (options.url.endsWith('/com.atproto.server.createAccount')) {
        return okResponse(
          options.url,
          JSON.stringify({
            did,
            handle: 'alice.dest.pds.example',
            accessJwt: 'access-full',
            refreshJwt: 'refresh-full'
          })
        )
      }
      if (options.url.endsWith('/com.atproto.repo.importRepo')) {
        importRepoCount += 1
        return okResponse(options.url, '')
      }
      if (options.url.includes('/com.atproto.repo.listMissingBlobs')) {
        return okResponse(options.url, JSON.stringify({ blobs: [] }))
      }
      if (
        options.url.endsWith(
          '/com.atproto.identity.getRecommendedDidCredentials'
        )
      ) {
        return okResponse(
          options.url,
          JSON.stringify({
            services: {
              atproto_pds: {
                type: 'AtprotoPersonalDataServer',
                endpoint: DEST_PDS
              }
            },
            verificationMethods: { atproto: destSigningKey.did() },
            alsoKnownAs: ['at://alice.dest.pds.example'],
            // Include duplicate recovery key and server key to verify dedupe & removal.
            rotationKeys: [
              destRotKey1.did(),
              serverKey.did(),
              recoveryKey.did(),
              destRotKey2.did(),
              destRotKey1.did()
            ]
          })
        )
      }
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        activateCount += 1
        return okResponse(options.url, '')
      }
      if (options.url.endsWith('/com.atproto.server.deleteSession')) {
        deleteSessionCalls += 1
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    await startMoveOut({
      database,
      actor,
      pdsUrl: DEST_PDS,
      handle: 'alice.dest.pds.example',
      email: 'alice@example.com',
      password: 'new-password'
    })

    const stateDuringMove = await getHostedBlueskyAccountState({
      database,
      actor
    })
    expect(stateDuringMove.moveOut).toEqual({
      pdsUrl: DEST_PDS,
      handle: 'alice.dest.pds.example',
      stage: 'started'
    })
    expect(stateDuringMove.movedTo).toBeNull()

    await sendMoveOutRepo({ database, actor })
    expect(importRepoCount).toBe(1)

    // Posting keeps working during the copy; rev changes.
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'post during move',
        createdAt: new Date().toISOString()
      }
    })

    const prevPlcOps = plcOpsByDid.get(did)!
    const prevLast = prevPlcOps[prevPlcOps.length - 1]
    const expectedPrevCid = await cidForOperation(prevLast)

    const finished = await finishMoveOut({ database, actor })

    // Repo was re-sent at finish because rev changed.
    expect(importRepoCount).toBe(2)
    expect(activateCount).toBe(1)

    // PLC operation chains on last op, keeps recovery key first, drops server key, no duplicates.
    const allPlcOps = plcOpsByDid.get(did)!
    const switchOp = allPlcOps[allPlcOps.length - 1]
    expect(switchOp.prev).toBe(expectedPrevCid)
    expect(switchOp.alsoKnownAs).toEqual(['at://alice.dest.pds.example'])
    expect(switchOp.verificationMethods).toEqual({
      atproto: destSigningKey.did()
    })
    expect(switchOp.services).toEqual({
      atproto_pds: {
        type: 'AtprotoPersonalDataServer',
        endpoint: DEST_PDS
      }
    })
    expect(switchOp.rotationKeys).toEqual([
      recoveryKey.did(),
      destRotKey1.did(),
      destRotKey2.did()
    ])
    expect(switchOp.rotationKeys).not.toContain(serverKey.did())
    expect(await verifyPlcOperationSignature(switchOp, [serverKey.did()])).toBe(
      true
    )

    // #identity and #account active:false status:deactivated emitted.
    const eventsAfterFinish = (await database.listPdsEvents({ did })).map(
      decodePdsEvent
    )
    const tail = eventsAfterFinish.slice(-2)
    expect(tail[0]).toMatchObject({
      type: 'identity',
      did,
      handle: 'alice.dest.pds.example'
    })
    expect(tail[1]).toMatchObject({
      type: 'account',
      did,
      active: false,
      status: 'deactivated'
    })

    // Hosted bluesky_accounts row and stored move session are gone.
    expect(await database.getBlueskyAccount({ actorId: actor.id })).toBeNull()
    expect(await database.getBlueskySession({ did })).toBeNull()

    // The switch cleared the local handle so a bare-domain handle is free.
    expect((await database.getPdsRepo({ did }))?.handle).toBeNull()
    expect(await database.getPdsRepoByHandle({ handle })).toBeNull()

    // The destination session was revoked after the move completed.
    expect(deleteSessionCalls).toBe(1)

    // Every authenticated request went to the stored destination origin.
    for (const call of fetchCalls) {
      const origin = new URL(call.url).origin
      if (origin === PLC_DIRECTORY) continue
      expect(origin).toBe(DEST_PDS)
    }

    // State reports movedTo and does NOT recreate hosted bluesky_accounts row.
    expect(finished.movedTo).toBe(DEST_HOST)
    expect(finished.state).toMatchObject({
      movedTo: DEST_HOST,
      moveOut: null,
      customHandleAllowed: false,
      repo: { did, status: 'deactivated' }
    })
    await getHostedBlueskyAccountState({ database, actor })
    expect(await database.getBlueskyAccount({ actorId: actor.id })).toBeNull()

    // Reactivation is refused.
    await expect(
      reactivateHostedBlueskyAccount({ database, actor })
    ).rejects.toBeInstanceOf(PdsAccountMovedError)
    expect((await database.getPdsRepo({ did }))?.status).toBe('deactivated')

    // Deleting the moved copy sends NO PLC op and emits NO #account event.
    const plcCountBeforeDelete = plcOpsByDid.get(did)!.length
    const eventsCountBeforeDelete = (await database.listPdsEvents({ did }))
      .length

    await deleteHostedBlueskyAccount({
      database,
      actor,
      confirmHandle: handle
    })

    expect(plcOpsByDid.get(did)!.length).toBe(plcCountBeforeDelete)
    expect((await database.listPdsEvents({ did })).length).toBe(
      eventsCountBeforeDelete
    )
    expect(await database.getPdsRepo({ actorId: actor.id })).toBeNull()
  })

  it('completes a full move to an entryway that recommends a PDS endpoint on another host', async () => {
    const { actor, did } = await setupHostedAccount('move-entryway')
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()
    // bsky.social is an entryway: it recommends its own backend host, not the
    // origin the owner typed.
    const backendEndpoint = 'https://amanita.us-east.host.bsky.network'

    let importRepoCount = 0
    let activateCalls = 0
    destHandler = (options) => {
      if (options.url.endsWith('/com.atproto.server.describeServer')) {
        return okResponse(options.url, JSON.stringify({ did: DEST_DID }))
      }
      if (options.url.endsWith('/com.atproto.server.createAccount')) {
        return okResponse(
          options.url,
          JSON.stringify({
            did,
            handle: 'alice.dest.pds.example',
            accessJwt: 'access-entryway',
            refreshJwt: 'refresh-entryway'
          })
        )
      }
      if (options.url.endsWith('/com.atproto.repo.importRepo')) {
        importRepoCount += 1
        return okResponse(options.url, '')
      }
      if (
        options.url.endsWith(
          '/com.atproto.identity.getRecommendedDidCredentials'
        )
      ) {
        return okResponse(
          options.url,
          JSON.stringify({
            services: {
              atproto_pds: {
                type: 'AtprotoPersonalDataServer',
                endpoint: backendEndpoint
              }
            },
            verificationMethods: { atproto: destSigningKey.did() },
            alsoKnownAs: ['at://alice.dest.pds.example'],
            rotationKeys: [destRotKey.did()]
          })
        )
      }
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        activateCalls += 1
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    await startMoveOut({
      database,
      actor,
      pdsUrl: DEST_PDS,
      handle: 'alice.dest.pds.example',
      email: 'alice@example.com',
      password: 'new-password'
    })
    await sendMoveOutRepo({ database, actor })
    const finished = await finishMoveOut({ database, actor })

    expect(importRepoCount).toBe(1)
    expect(activateCalls).toBe(1)
    expect(finished.movedTo).toBe(DEST_HOST)

    // The PLC operation takes the recommended backend endpoint.
    const allPlcOps = plcOpsByDid.get(did)!
    const switchOp = allPlcOps[allPlcOps.length - 1]
    expect(switchOp.services).toEqual({
      atproto_pds: {
        type: 'AtprotoPersonalDataServer',
        endpoint: backendEndpoint
      }
    })

    // Every destination request still went to the typed origin, not the
    // backend host the entryway recommended.
    for (const call of fetchCalls) {
      const origin = new URL(call.url).origin
      if (origin === PLC_DIRECTORY) continue
      expect(origin).toBe(DEST_PDS)
    }
  })

  it('sets rotation keys without a recovery key and skips repo re-send when rev is unchanged', async () => {
    const { actor, did } = await setupHostedAccount('move-full-norecovery')
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()
    const serverKey = await serverRotationKeypair()

    const currentRepo = await database.getPdsRepo({ did })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'bob.dest.pds.example',
      accessJwt: 'access-2',
      refreshJwt: 'refresh-2',
      importedRev: currentRepo!.rev,
      switchedAt: null
    })

    let importRepoCount = 0
    destHandler = (options) => {
      if (options.url.endsWith('/com.atproto.repo.importRepo')) {
        importRepoCount += 1
        return okResponse(options.url, '')
      }
      if (
        options.url.endsWith(
          '/com.atproto.identity.getRecommendedDidCredentials'
        )
      ) {
        return okResponse(
          options.url,
          JSON.stringify({
            services: {
              atproto_pds: {
                type: 'AtprotoPersonalDataServer',
                endpoint: DEST_PDS
              }
            },
            verificationMethods: { atproto: destSigningKey.did() },
            alsoKnownAs: ['at://bob.dest.pds.example'],
            rotationKeys: [serverKey.did(), destRotKey.did()]
          })
        )
      }
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    await finishMoveOut({ database, actor })

    expect(importRepoCount).toBe(0)
    const switchOp = plcOpsByDid.get(did)!.at(-1)!
    expect(switchOp.rotationKeys).toEqual([destRotKey.did()])
    expect(switchOp.rotationKeys).not.toContain(serverKey.did())
  })

  it('retries finishMoveOut after switch by only re-running activateAccount and cleanup', async () => {
    const { actor, did } = await setupHostedAccount('move-retry')
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()
    const currentRepo = await database.getPdsRepo({ did })

    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'retry.dest.pds.example',
      accessJwt: 'access-retry',
      refreshJwt: 'refresh-retry',
      importedRev: currentRepo!.rev,
      switchedAt: null
    })

    let credsCalls = 0
    let activateCalls = 0
    destHandler = (options) => {
      if (
        options.url.endsWith(
          '/com.atproto.identity.getRecommendedDidCredentials'
        )
      ) {
        credsCalls += 1
        return okResponse(
          options.url,
          JSON.stringify({
            services: {
              atproto_pds: {
                type: 'AtprotoPersonalDataServer',
                endpoint: DEST_PDS
              }
            },
            verificationMethods: { atproto: destSigningKey.did() },
            alsoKnownAs: ['at://retry.dest.pds.example'],
            rotationKeys: [destRotKey.did()]
          })
        )
      }
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        activateCalls += 1
        if (activateCalls === 1) {
          return okResponse(
            options.url,
            JSON.stringify({ error: 'UpstreamError', message: 'Try again' }),
            503
          )
        }
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    // First attempt fails at activateAccount after PLC switch.
    await expect(finishMoveOut({ database, actor })).rejects.toBeInstanceOf(
      PdsMoveOutRemoteError
    )
    expect(credsCalls).toBe(1)
    expect(activateCalls).toBe(1)

    const plcCountAfterSwitch = plcOpsByDid.get(did)!.length
    const eventCountAfterSwitch = (await database.listPdsEvents({ did })).length

    const midState = await getHostedBlueskyAccountState({ database, actor })
    expect(midState.movedTo).toBe(DEST_HOST)
    expect(midState.moveOut).toEqual({
      pdsUrl: DEST_PDS,
      handle: 'retry.dest.pds.example',
      stage: 'switched'
    })

    // Cannot cancel once switched.
    await expect(cancelMoveOut({ database, actor })).rejects.toBeInstanceOf(
      PdsMoveOutSwitchedError
    )

    // Second attempt skips PLC/credentials/events and only runs activateAccount + cleanup.
    const retried = await finishMoveOut({ database, actor })
    expect(credsCalls).toBe(1)
    expect(activateCalls).toBe(2)
    expect(plcOpsByDid.get(did)!.length).toBe(plcCountAfterSwitch)
    expect((await database.listPdsEvents({ did })).length).toBe(
      eventCountAfterSwitch
    )
    expect(await database.getBlueskyAccount({ actorId: actor.id })).toBeNull()
    expect(await database.getBlueskySession({ did })).toBeNull()
    expect(retried.state.moveOut).toBeNull()
    expect(retried.state.movedTo).toBe(DEST_HOST)
  })

  it('cancels before switch, removes stored move, and leaves local hosted account working', async () => {
    const { actor, did } = await setupHostedAccount('move-cancel')

    // No move stored -> refuses cancel with 409.
    await expect(cancelMoveOut({ database, actor })).rejects.toBeInstanceOf(
      PdsMoveOutNotFoundError
    )
    expect(await getMoveOutProgress({ database, actor })).toBeNull()

    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'cancel.dest.pds.example',
      accessJwt: 'access-c',
      refreshJwt: 'refresh-c',
      importedRev: null,
      switchedAt: null
    })

    const plcCountBefore = plcOpsByDid.get(did)!.length
    const eventsBefore = (await database.listPdsEvents({ did })).length

    let deleteSessionCalls = 0
    destHandler = (options) => {
      if (options.url.endsWith('/com.atproto.server.deleteSession')) {
        deleteSessionCalls += 1
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    const cancelled = await cancelMoveOut({ database, actor })
    expect(cancelled).toMatchObject({
      cancelled: true,
      pdsUrl: DEST_PDS,
      handle: 'cancel.dest.pds.example',
      remoteAccountRemains: true,
      message: expect.stringContaining('remains')
    })

    expect(await database.getBlueskySession({ did })).toBeNull()
    expect(plcOpsByDid.get(did)!.length).toBe(plcCountBefore)
    expect((await database.listPdsEvents({ did })).length).toBe(eventsBefore)
    expect(deleteSessionCalls).toBe(1)
    expect((await database.getPdsRepo({ did }))?.status).toBe('active')
    expect(
      await database.getBlueskyAccount({ actorId: actor.id })
    ).not.toBeNull()
    expect(cancelled.state).toMatchObject({
      movedTo: null,
      moveOut: null,
      repo: { did, status: 'active' }
    })

    // Account still accepts writes.
    await expect(
      createPdsRecord(database, {
        did,
        collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post',
          text: 'still working after cancel',
          createdAt: new Date().toISOString()
        }
      })
    ).resolves.toMatchObject({ uri: expect.stringContaining(did) })
  })

  it('never treats a move-out session as an OAuth or app-password session', async () => {
    const actor = await createActor('move-isolation')
    const did = 'did:plc:moveisolationtest0000000'
    await database.saveBlueskyAccount({
      actorId: actor.id,
      did,
      handle: 'alice.dest.pds.example',
      pdsUrl: DEST_PDS,
      authType: 'app_password',
      domainHandle: false,
      crosspostByDefault: false
    })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'alice.dest.pds.example',
      accessJwt: 'move-access',
      refreshJwt: 'move-refresh',
      importedRev: null,
      switchedAt: null
    })

    // getBlueskyAgent must not treat a move-out session as oauth or app_password.
    expect(await getBlueskyAgent(database, actor)).toBeNull()

    // Deleting oauth or app_password sessions must leave move-out intact.
    await deleteStoredBlueskySession(database, did, 'oauth')
    await deleteStoredBlueskySession(database, did, 'app_password')
    expect(await readStoredBlueskySession(database, did)).toMatchObject({
      type: 'move-out'
    })
  })

  it('continues the blob batch when a remote uploadBlob fails and refreshes on 400 ExpiredToken', async () => {
    const { actor, did } = await setupHostedAccount('move-blob-remote-fail')
    const store = createMemoryBlobStore()
    const blobA = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('blob-a-bytes'), mimeType: 'image/png' },
      { store }
    )
    const blobB = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('blob-b-bytes'), mimeType: 'image/png' },
      { store }
    )
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'two blobs',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [
            { alt: 'a', image: blobA.blob },
            { alt: 'b', image: blobB.blob }
          ]
        }
      }
    })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'alice.dest.pds.example',
      accessJwt: 'stale-400-access',
      refreshJwt: 'refresh-400',
      importedRev: null,
      switchedAt: null
    })

    let uploadCall = 0
    destHandler = (options) => {
      const headers = options.headers as Record<string, string>
      if (options.url.includes('/com.atproto.repo.listMissingBlobs')) {
        if (headers.Authorization === 'Bearer stale-400-access') {
          return okResponse(
            options.url,
            JSON.stringify({ error: 'ExpiredToken', message: 'Expired' }),
            400
          )
        }
        return okResponse(
          options.url,
          JSON.stringify({
            blobs: [
              { cid: blobA.cid, recordUri: `at://${did}/app.bsky.feed.post/1` },
              { cid: blobB.cid, recordUri: `at://${did}/app.bsky.feed.post/1` }
            ]
          })
        )
      }
      if (options.url.endsWith('/com.atproto.server.refreshSession')) {
        return okResponse(
          options.url,
          JSON.stringify({
            did,
            accessJwt: 'new-400-access',
            refreshJwt: 'new-400-refresh'
          })
        )
      }
      if (options.url.endsWith('/com.atproto.repo.uploadBlob')) {
        expect(headers.Authorization).toBe('Bearer new-400-access')
        uploadCall += 1
        if (uploadCall === 1) {
          return okResponse(
            options.url,
            JSON.stringify({ error: 'BlobTooLarge', message: 'Too big' }),
            413
          )
        }
        return okResponse(
          options.url,
          JSON.stringify({ blob: { $type: 'blob' } })
        )
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    const batch = await copyMoveOutBlobs({ database, actor, store })
    expect(batch.copied).toBe(1)
    expect(batch.done).toBe(true)
    expect(batch.failed).toHaveLength(1)
    expect(batch.failed[0]).toMatchObject({
      cid: blobA.cid,
      reason: expect.stringContaining('BlobTooLarge')
    })
  })

  it('sends nothing more after the switch once the repo was taken down', async () => {
    const { actor, did } = await setupHostedAccount('move-retry-takendown')
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()

    await database.updatePdsRepoIdentity({
      did,
      plcOperation: JSON.stringify({
        type: 'plc_operation',
        rotationKeys: [destRotKey.did()],
        verificationMethods: { atproto: destSigningKey.did() },
        alsoKnownAs: ['at://takendown.dest.pds.example'],
        services: {
          atproto_pds: {
            type: 'AtprotoPersonalDataServer',
            endpoint: DEST_PDS
          }
        },
        prev: 'bafyprev',
        sig: 'sig'
      })
    })
    // An admin took the copy down after the switch, before activation.
    await database.updatePdsRepoStatus({ did, status: 'takendown' })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'takendown.dest.pds.example',
      accessJwt: 'access-td',
      refreshJwt: 'refresh-td',
      importedRev: 'stale-rev',
      switchedAt: Date.now()
    })

    const copyCalls: string[] = []
    let activateCalls = 0
    destHandler = (options) => {
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        activateCalls += 1
        return okResponse(options.url, '')
      }
      if (options.url.endsWith('/com.atproto.server.deleteSession')) {
        return okResponse(options.url, '')
      }
      copyCalls.push(new URL(options.url).pathname)
      return okResponse(options.url, defaultDestBody(options.url))
    }

    await finishMoveOut({ database, actor })
    expect(activateCalls).toBe(1)
    expect(copyCalls).toEqual([])
  })

  it('skips straight to activateAccount on retry when stored plcOperation already points to the destination even if switchedAt is null', async () => {
    const { actor, did } = await setupHostedAccount('move-retry-plc-only')
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()

    // Simulate a crash after storing the switched plcOperation, before setting switchedAt.
    await database.updatePdsRepoIdentity({
      did,
      plcOperation: JSON.stringify({
        type: 'plc_operation',
        rotationKeys: [destRotKey.did()],
        verificationMethods: { atproto: destSigningKey.did() },
        alsoKnownAs: ['at://plc-only.dest.pds.example'],
        services: {
          atproto_pds: {
            type: 'AtprotoPersonalDataServer',
            endpoint: DEST_PDS
          }
        },
        prev: 'bafyprev',
        sig: 'sig'
      })
    })
    await database.updatePdsRepoStatus({ did, status: 'deactivated' })
    const currentRepo = await database.getPdsRepo({ did })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'plc-only.dest.pds.example',
      accessJwt: 'access-plc-only',
      refreshJwt: 'refresh-plc-only',
      importedRev: currentRepo!.rev,
      switchedAt: null
    })

    const plcCountBefore = plcOpsByDid.get(did)!.length
    let activateCalls = 0
    let otherCalls = 0
    destHandler = (options) => {
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        activateCalls += 1
        return okResponse(options.url, '')
      }
      // Revoking the destination session is part of cleanup, and finish always
      // asks what is still missing and sends the preferences; none of these
      // re-send the repo or sign anything.
      if (
        options.url.endsWith('/com.atproto.server.deleteSession') ||
        options.url.includes('/com.atproto.repo.listMissingBlobs') ||
        options.url.endsWith('/app.bsky.actor.putPreferences')
      ) {
        return okResponse(options.url, defaultDestBody(options.url))
      }
      otherCalls += 1
      return okResponse(options.url, defaultDestBody(options.url))
    }

    const result = await finishMoveOut({ database, actor })
    expect(activateCalls).toBe(1)
    expect(otherCalls).toBe(0)
    expect(plcOpsByDid.get(did)!.length).toBe(plcCountBefore)
    expect(await database.getBlueskyAccount({ actorId: actor.id })).toBeNull()
    expect(await database.getBlueskySession({ did })).toBeNull()
    expect(result.movedTo).toBe(DEST_HOST)
  })

  it('preserves a newly linked outside account and its session when deleting a moved local copy', async () => {
    const { actor, did, handle } = await setupHostedAccount(
      'move-delete-keeps-link'
    )
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()
    const currentRepo = await database.getPdsRepo({ did })

    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'moved.dest.pds.example',
      accessJwt: 'access-keep',
      refreshJwt: 'refresh-keep',
      importedRev: currentRepo!.rev,
      switchedAt: null
    })

    destHandler = (options) => {
      if (
        options.url.endsWith(
          '/com.atproto.identity.getRecommendedDidCredentials'
        )
      ) {
        return okResponse(
          options.url,
          JSON.stringify({
            services: {
              atproto_pds: {
                type: 'AtprotoPersonalDataServer',
                endpoint: DEST_PDS
              }
            },
            verificationMethods: { atproto: destSigningKey.did() },
            alsoKnownAs: ['at://moved.dest.pds.example'],
            rotationKeys: [destRotKey.did()]
          })
        )
      }
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    await finishMoveOut({ database, actor })

    // Owner links their moved account on the new PDS with an app password.
    await database.saveBlueskyAccount({
      actorId: actor.id,
      did,
      handle: 'moved.dest.pds.example',
      pdsUrl: DEST_PDS,
      authType: 'app_password',
      domainHandle: false,
      crosspostByDefault: true
    })
    await writeStoredBlueskySession(database, did, {
      type: 'app_password',
      accessJwt: 'linked-access',
      refreshJwt: 'linked-refresh'
    })

    await deleteHostedBlueskyAccount({
      database,
      actor,
      confirmHandle: handle
    })

    expect(
      await database.getBlueskyAccount({ actorId: actor.id })
    ).toMatchObject({
      did,
      authType: 'app_password',
      handle: 'moved.dest.pds.example'
    })
    expect(await readStoredBlueskySession(database, did)).toEqual({
      type: 'app_password',
      accessJwt: 'linked-access',
      refreshJwt: 'linked-refresh'
    })
  })

  it('refuses a destination that claims a DID for another host before signing a token', async () => {
    const { actor } = await setupHostedAccount('move-dest-did')
    destHandler = (options) =>
      okResponse(
        options.url,
        JSON.stringify({ did: 'did:web:other.pds.example' })
      )

    await expect(
      startMoveOut({
        database,
        actor,
        pdsUrl: DEST_PDS,
        handle: 'alice.dest.pds.example',
        email: 'alice@example.com',
        password: 'new-account-password'
      })
    ).rejects.toMatchObject({
      code: 'MoveOutRemoteError',
      message: "That server didn't identify itself as dest.pds.example."
    })

    // Only describeServer ran: no service-auth token was signed or sent.
    expect(
      fetchCalls
        .filter((call) => new URL(call.url).origin !== PLC_DIRECTORY)
        .map((call) => new URL(call.url).pathname)
    ).toEqual(['/xrpc/com.atproto.server.describeServer'])
  })

  it('refuses a createAccount response for a different DID', async () => {
    const { actor, did } = await setupHostedAccount('move-create-did')
    destHandler = (options) => {
      if (options.url.endsWith('/com.atproto.server.describeServer')) {
        return okResponse(options.url, JSON.stringify({ did: DEST_DID }))
      }
      return okResponse(
        options.url,
        JSON.stringify({
          did: 'did:plc:someoneelse0000000000000000',
          handle: 'alice.dest.pds.example',
          accessJwt: 'a',
          refreshJwt: 'r'
        })
      )
    }

    await expect(
      startMoveOut({
        database,
        actor,
        pdsUrl: DEST_PDS,
        handle: 'alice.dest.pds.example',
        email: 'alice@example.com',
        password: 'new-account-password'
      })
    ).rejects.toBeInstanceOf(PdsMoveOutRemoteError)
    expect(await database.getBlueskySession({ did })).toBeNull()
  })

  it('refuses a createAccount response with a different handle', async () => {
    const { actor, did } = await setupHostedAccount('move-handle-mismatch')
    destHandler = (options) => {
      if (options.url.endsWith('/com.atproto.server.describeServer')) {
        return okResponse(options.url, JSON.stringify({ did: DEST_DID }))
      }
      return okResponse(
        options.url,
        JSON.stringify({
          did,
          handle: 'someone-else.dest.pds.example',
          accessJwt: 'a',
          refreshJwt: 'r'
        })
      )
    }

    await expect(
      startMoveOut({
        database,
        actor,
        pdsUrl: DEST_PDS,
        handle: 'alice.dest.pds.example',
        email: 'alice@example.com',
        password: 'new-account-password'
      })
    ).rejects.toMatchObject({
      code: 'MoveOutRemoteError',
      message: expect.stringContaining('different handle')
    })
    expect(await database.getBlueskySession({ did })).toBeNull()
  })

  it('refuses to start a move for an inactive account or an invalid email without fetching', async () => {
    const { actor } = await setupHostedAccount('move-inactive')
    await deactivateHostedBlueskyAccount({ database, actor })
    fetchCalls.length = 0

    await expect(
      startMoveOut({
        database,
        actor,
        pdsUrl: DEST_PDS,
        handle: 'alice.dest.pds.example',
        email: 'alice@example.com',
        password: 'new-account-password'
      })
    ).rejects.toBeInstanceOf(PdsHostedAccountInactiveError)
    expect(fetchCalls).toHaveLength(0)

    const { actor: emailActor } = await setupHostedAccount('move-invalid-email')
    fetchCalls.length = 0

    await expect(
      startMoveOut({
        database,
        actor: emailActor,
        pdsUrl: DEST_PDS,
        handle: 'alice.dest.pds.example',
        email: 'not-an-email',
        password: 'new-account-password'
      })
    ).rejects.toBeInstanceOf(PdsValidationError)
    expect(fetchCalls).toHaveLength(0)
  })

  it('processes at most limit blobs per batch and ends on an empty page or a stuck cursor', async () => {
    const { actor, did } = await setupHostedAccount('move-blob-bounds')
    const store = createMemoryBlobStore()
    const blobs: Awaited<ReturnType<typeof uploadPdsBlob>>[] = []
    for (const name of ['one', 'two', 'three']) {
      blobs.push(
        await uploadPdsBlob(
          database,
          { did, bytes: Buffer.from(`blob-${name}`), mimeType: 'image/png' },
          { store }
        )
      )
    }
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'three blobs',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: blobs.map((blob, index) => ({
            alt: `image-${index}`,
            image: blob.blob
          }))
        }
      }
    })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'alice.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: null,
      switchedAt: null
    })

    let uploads = 0
    destHandler = (options) => {
      if (options.url.includes('/com.atproto.repo.listMissingBlobs')) {
        const cursor = new URL(options.url).searchParams.get('cursor')
        if (cursor === 'empty') {
          return okResponse(options.url, JSON.stringify({ blobs: [] }))
        }
        if (cursor === 'stuck') {
          return okResponse(
            options.url,
            JSON.stringify({
              cursor: 'stuck',
              blobs: [{ cid: blobs[0].cid }]
            })
          )
        }
        return okResponse(
          options.url,
          JSON.stringify({
            cursor: 'next',
            blobs: blobs.map((blob) => ({ cid: blob.cid }))
          })
        )
      }
      if (options.url.endsWith('/com.atproto.repo.uploadBlob')) {
        uploads += 1
        return okResponse(
          options.url,
          JSON.stringify({ blob: { $type: 'blob' } })
        )
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    const first = await copyMoveOutBlobs({ database, actor, limit: 2, store })
    expect(first).toMatchObject({
      copied: 2,
      cursor: 'next',
      done: false
    })
    expect(uploads).toBe(2)
    // The destination listed more than asked and its cursor is past them: the
    // untried ones are reported, not silently dropped.
    expect(first.failed).toEqual(
      blobs.slice(2).map((blob) => ({
        cid: blob.cid,
        reason: 'Not copied: the server listed more than it was asked for.'
      }))
    )

    const empty = await copyMoveOutBlobs({
      database,
      actor,
      cursor: 'empty',
      limit: 2,
      store
    })
    expect(empty).toMatchObject({ copied: 0, cursor: null, done: true })

    const stuck = await copyMoveOutBlobs({
      database,
      actor,
      cursor: 'stuck',
      limit: 2,
      store
    })
    expect(stuck.done).toBe(true)
    expect(stuck.cursor).toBe('stuck')
  })

  it('completes the local switch when the stored operation already points at the destination but the repo is still active', async () => {
    const { actor, did } = await setupHostedAccount('move-retry-active')
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()
    const currentRepo = await database.getPdsRepo({ did })

    // Simulate a crash after storing the switched operation, before the switch.
    await database.updatePdsRepoIdentity({
      did,
      plcOperation: JSON.stringify({
        type: 'plc_operation',
        rotationKeys: [destRotKey.did()],
        verificationMethods: { atproto: destSigningKey.did() },
        alsoKnownAs: ['at://retry-active.dest.pds.example'],
        services: {
          atproto_pds: {
            type: 'AtprotoPersonalDataServer',
            endpoint: DEST_PDS
          }
        },
        prev: 'bafyprev',
        sig: 'sig'
      })
    })
    expect((await database.getPdsRepo({ did }))?.status).toBe('active')

    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'retry-active.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: currentRepo!.rev,
      switchedAt: null
    })

    destHandler = (options) => {
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        return okResponse(options.url, '')
      }
      if (options.url.endsWith('/com.atproto.server.deleteSession')) {
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    await finishMoveOut({ database, actor })

    const repo = await database.getPdsRepo({ did })
    expect(repo?.status).toBe('deactivated')
    expect(repo?.handle).toBeNull()
    const tail = (await database.listPdsEvents({ did }))
      .map(decodePdsEvent)
      .slice(-2)
    expect(tail[0]).toMatchObject({ type: 'identity', did })
    expect(tail[1]).toMatchObject({
      type: 'account',
      did,
      active: false,
      status: 'deactivated'
    })
  })

  it('still announces the switch when an event write failed on the first try', async () => {
    const { actor, did } = await setupHostedAccount('move-retry-event')
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()
    const currentRepo = await database.getPdsRepo({ did })

    // Simulate a crash after storing the switched operation, before the switch.
    await database.updatePdsRepoIdentity({
      did,
      plcOperation: JSON.stringify({
        type: 'plc_operation',
        rotationKeys: [destRotKey.did()],
        verificationMethods: { atproto: destSigningKey.did() },
        alsoKnownAs: ['at://retry-active.dest.pds.example'],
        services: {
          atproto_pds: {
            type: 'AtprotoPersonalDataServer',
            endpoint: DEST_PDS
          }
        },
        prev: 'bafyprev',
        sig: 'sig'
      })
    })
    expect((await database.getPdsRepo({ did }))?.status).toBe('active')

    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'retry-active.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: currentRepo!.rev,
      switchedAt: null
    })

    destHandler = (options) => {
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        return okResponse(options.url, '')
      }
      if (options.url.endsWith('/com.atproto.server.deleteSession')) {
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    // The #account write fails once; the retry must still send it.
    const append = database.appendPdsEvent.bind(database)
    let calls = 0
    const spy = vi
      .spyOn(database, 'appendPdsEvent')
      .mockImplementation(async (params) => {
        calls += 1
        if (calls === 2) throw new Error('database unavailable')
        return append(params)
      })
    await expect(finishMoveOut({ database, actor })).rejects.toThrow(
      'database unavailable'
    )
    await finishMoveOut({ database, actor })
    spy.mockRestore()

    const repo = await database.getPdsRepo({ did })
    expect(repo?.status).toBe('deactivated')
    expect(repo?.handle).toBeNull()
    const tail = (await database.listPdsEvents({ did }))
      .map(decodePdsEvent)
      .slice(-2)
    expect(tail[0]).toMatchObject({ type: 'identity', did })
    expect(tail[1]).toMatchObject({
      type: 'account',
      did,
      active: false,
      status: 'deactivated'
    })
  })

  it('does not resurrect a cancelled move when a token refresh finishes afterwards', async () => {
    const { actor, did } = await setupHostedAccount('move-refresh-cancel')
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'alice.dest.pds.example',
      accessJwt: 'expired-access',
      refreshJwt: 'refresh-before-cancel',
      importedRev: null,
      switchedAt: null
    })

    destHandler = async (options) => {
      const headers = options.headers as Record<string, string>
      if (options.url.endsWith('/com.atproto.server.checkAccountStatus')) {
        return okResponse(
          options.url,
          JSON.stringify({ error: 'ExpiredToken', message: 'Expired' }),
          401
        )
      }
      if (options.url.endsWith('/com.atproto.server.refreshSession')) {
        expect(headers.Authorization).toBe('Bearer refresh-before-cancel')
        // A cancel lands while the refresh is in flight.
        await database.deleteBlueskySession({ did })
        return okResponse(
          options.url,
          JSON.stringify({
            did,
            accessJwt: 'fresh-access',
            refreshJwt: 'fresh-refresh'
          })
        )
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    await expect(
      getMoveOutProgress({ database, actor })
    ).rejects.toBeInstanceOf(PdsMoveOutNotFoundError)
    expect(await database.getBlueskySession({ did })).toBeNull()
  })

  it('builds the next rotation keys from the directory operation, not the stored recovery key', async () => {
    const { actor, did } = await setupHostedAccount('move-rotation-dir')
    const recoveryKey = await Secp256k1Keypair.create()
    const directoryKey = await Secp256k1Keypair.create()
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()
    const serverKey = await serverRotationKeypair()

    await setHostedBlueskyRecoveryKey({
      database,
      actor,
      recoveryKeyDid: recoveryKey.did()
    })

    // The directory's last operation lists a different key first, not the
    // recovery key stored on the repo row.
    plcOpsByDid.set(did, [
      {
        type: 'plc_operation',
        rotationKeys: [directoryKey.did(), serverKey.did()],
        verificationMethods: { atproto: destSigningKey.did() },
        alsoKnownAs: ['at://rotation.dest.pds.example'],
        services: {
          atproto_pds: {
            type: 'AtprotoPersonalDataServer',
            endpoint: `https://${PDS_HOSTNAME}`
          }
        },
        prev: 'bafyprev',
        sig: 'sig'
      }
    ])

    const currentRepo = await database.getPdsRepo({ did })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'rotation.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: currentRepo!.rev,
      switchedAt: null
    })

    destHandler = (options) => {
      if (
        options.url.endsWith(
          '/com.atproto.identity.getRecommendedDidCredentials'
        )
      ) {
        return okResponse(
          options.url,
          JSON.stringify({
            services: {
              atproto_pds: {
                type: 'AtprotoPersonalDataServer',
                endpoint: DEST_PDS
              }
            },
            verificationMethods: { atproto: destSigningKey.did() },
            alsoKnownAs: ['at://rotation.dest.pds.example'],
            rotationKeys: [destRotKey.did()]
          })
        )
      }
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        return okResponse(options.url, '')
      }
      if (options.url.endsWith('/com.atproto.server.deleteSession')) {
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    await finishMoveOut({ database, actor })

    const switchOp = plcOpsByDid.get(did)!.at(-1)!
    expect(switchOp.rotationKeys).toEqual([
      directoryKey.did(),
      destRotKey.did()
    ])
    expect(switchOp.rotationKeys).not.toContain(recoveryKey.did())
    expect(switchOp.rotationKeys).not.toContain(serverKey.did())
  })

  it('refuses to cancel when the directory already points at the destination', async () => {
    const { actor, did } = await setupHostedAccount('move-cancel-switched')
    const serverKey = await serverRotationKeypair()
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'cancel.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: null,
      switchedAt: null
    })
    plcOpsByDid.set(did, [
      {
        type: 'plc_operation',
        rotationKeys: [serverKey.did()],
        verificationMethods: { atproto: 'did:key:zExample' },
        alsoKnownAs: ['at://cancel.dest.pds.example'],
        services: {
          atproto_pds: {
            type: 'AtprotoPersonalDataServer',
            endpoint: DEST_PDS
          }
        },
        prev: 'bafyprev',
        sig: 'sig'
      }
    ])

    await expect(cancelMoveOut({ database, actor })).rejects.toBeInstanceOf(
      PdsMoveOutSwitchedError
    )
    expect(await database.getBlueskySession({ did })).not.toBeNull()
  })

  it('reports a local blob read failure without leaking the error and logs it', async () => {
    const { actor, did } = await setupHostedAccount('move-blob-read-error')
    const store = createMemoryBlobStore()
    const blob = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('read-error-bytes'), mimeType: 'image/png' },
      { store }
    )
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'one blob',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'one', image: blob.blob }]
        }
      }
    })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'alice.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: null,
      switchedAt: null
    })

    const errorSpy = vi.spyOn(logger, 'error')
    const throwingStore: PdsBlobObjectStore = {
      ...store,
      openRead: async () => {
        throw new Error('disk exploded')
      }
    }
    destHandler = (options) => {
      if (options.url.includes('/com.atproto.repo.listMissingBlobs')) {
        return okResponse(
          options.url,
          JSON.stringify({ blobs: [{ cid: blob.cid }] })
        )
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    const batch = await copyMoveOutBlobs({
      database,
      actor,
      store: throwingStore
    })
    expect(batch.failed).toEqual([
      { cid: blob.cid, reason: "Couldn't read this file on this server." }
    ])
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ did, cid: blob.cid })
    )
  })

  it('requires the domain PDS to be enabled for every move step', async () => {
    const { actor, did } = await setupHostedAccount('move-domain-gate')
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'alice.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: null,
      switchedAt: null
    })
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      [TEST_DOMAIN]: {
        enabled: false,
        hostname: PDS_HOSTNAME,
        allowEmails: [],
        allowActors: []
      }
    })

    await expect(sendMoveOutRepo({ database, actor })).rejects.toBeInstanceOf(
      PdsDisabledError
    )
    await expect(
      copyMoveOutPreferences({ database, actor })
    ).rejects.toBeInstanceOf(PdsDisabledError)
  })

  it('refuses to finish an unswitched move once the PDS config is gone', async () => {
    const { actor, did } = await setupHostedAccount('move-config-gone')
    const before = await database.getPdsRepo({ did })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'alice.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: before!.rev,
      switchedAt: null
    })
    let destCalls = 0
    destHandler = (options) => {
      destCalls += 1
      return okResponse(options.url, defaultDestBody(options.url))
    }
    // Without the config, the genesis op's endpoint (this server) would read as
    // "away"; finish must not take that as a switch that already happened.
    process.env.ACTIVITIES_BLUESKY_PDS = ''

    await expect(finishMoveOut({ database, actor })).rejects.toBeInstanceOf(
      PdsDisabledError
    )
    expect(destCalls).toBe(0)
    expect((await database.getPdsRepo({ did }))!.status).toBe('active')
  })

  it('reports the switched stage once the stored operation points at the destination', async () => {
    const { actor, did } = await setupHostedAccount('move-stage-plc')
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()
    await database.updatePdsRepoIdentity({
      did,
      plcOperation: JSON.stringify({
        type: 'plc_operation',
        rotationKeys: [destRotKey.did()],
        verificationMethods: { atproto: destSigningKey.did() },
        alsoKnownAs: ['at://stage.dest.pds.example'],
        services: {
          atproto_pds: {
            type: 'AtprotoPersonalDataServer',
            endpoint: DEST_PDS
          }
        },
        prev: 'bafyprev',
        sig: 'sig'
      })
    })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'stage.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: null,
      switchedAt: null
    })
    destHandler = (options) => {
      if (options.url.endsWith('/com.atproto.server.checkAccountStatus')) {
        return okResponse(
          options.url,
          JSON.stringify({ activated: false, validDid: false })
        )
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    const state = await getHostedBlueskyAccountState({ database, actor })
    expect(state.moveOut).toMatchObject({ stage: 'switched' })
    const progress = await getMoveOutProgress({ database, actor })
    expect(progress?.stage).toBe('switched')
  })

  it('treats an operation pointing at the entryway’s backend host as switched for stage, cancel and retry', async () => {
    const { actor, did } = await setupHostedAccount('move-stage-entryway')
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()
    // The entryway recommends its own backend host, not the origin the owner
    // typed; the switch still happened.
    const backendEndpoint = 'https://amanita.us-east.host.bsky.network'
    const currentRepo = await database.getPdsRepo({ did })
    await database.updatePdsRepoIdentity({
      did,
      plcOperation: JSON.stringify({
        type: 'plc_operation',
        rotationKeys: [destRotKey.did()],
        verificationMethods: { atproto: destSigningKey.did() },
        alsoKnownAs: ['at://stage.dest.pds.example'],
        services: {
          atproto_pds: {
            type: 'AtprotoPersonalDataServer',
            endpoint: backendEndpoint
          }
        },
        prev: 'bafyprev',
        sig: 'sig'
      })
    })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'stage.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: currentRepo!.rev,
      switchedAt: null
    })

    let activateCalls = 0
    destHandler = (options) => {
      if (options.url.endsWith('/com.atproto.server.checkAccountStatus')) {
        return okResponse(
          options.url,
          JSON.stringify({ activated: false, validDid: false })
        )
      }
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        activateCalls += 1
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    const progress = await getMoveOutProgress({ database, actor })
    expect(progress?.stage).toBe('switched')

    await expect(cancelMoveOut({ database, actor })).rejects.toBeInstanceOf(
      PdsMoveOutSwitchedError
    )

    const plcCountBefore = plcOpsByDid.get(did)!.length
    const finished = await finishMoveOut({ database, actor })
    expect(activateCalls).toBe(1)
    expect(finished.movedTo).toBe(DEST_HOST)
    // The switch already landed: no new PLC operation is submitted.
    expect(plcOpsByDid.get(did)!.length).toBe(plcCountBefore)
  })

  it('lets a profile that is no longer allowlisted start a move', async () => {
    const { actor, did } = await setupHostedAccount('move-not-allowlisted')
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      [TEST_DOMAIN]: {
        enabled: true,
        hostname: PDS_HOSTNAME,
        allowEmails: [],
        allowActors: []
      }
    })
    destHandler = (options) => {
      if (options.url.endsWith('/com.atproto.server.describeServer')) {
        return okResponse(options.url, JSON.stringify({ did: DEST_DID }))
      }
      return okResponse(
        options.url,
        JSON.stringify({
          did,
          handle: 'alice.dest.pds.example',
          accessJwt: 'a',
          refreshJwt: 'r'
        })
      )
    }

    const started = await startMoveOut({
      database,
      actor,
      pdsUrl: DEST_PDS,
      handle: 'alice.dest.pds.example',
      email: 'alice@example.com',
      password: 'new-account-password'
    })
    expect(started.moveOut).toMatchObject({
      pdsUrl: DEST_PDS,
      stage: 'started'
    })
  })

  it('copies the blobs and preferences the page skipped when finishing', async () => {
    const { actor, did } = await setupHostedAccount('move-finish-catch-up')
    const store = createMemoryBlobStore()
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()

    const blob = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('skipped-image'), mimeType: 'image/png' },
      { store }
    )
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'post',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'one', image: blob.blob }]
        }
      }
    })
    await database.putPdsPreferences({
      did,
      preferences: [
        { $type: 'app.bsky.actor.defs#adultContentPref', enabled: false }
      ]
    })

    // The repo step ran (rev unchanged since), but blobs and preferences never did.
    const currentRepo = await database.getPdsRepo({ did })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'catch-up.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: currentRepo!.rev,
      switchedAt: null
    })

    const uploaded: string[] = []
    const preferenceBodies: string[] = []
    let importRepoCount = 0
    destHandler = (options) => {
      if (
        options.url.endsWith(
          '/com.atproto.identity.getRecommendedDidCredentials'
        )
      ) {
        return okResponse(
          options.url,
          JSON.stringify({
            services: {
              atproto_pds: {
                type: 'AtprotoPersonalDataServer',
                endpoint: DEST_PDS
              }
            },
            verificationMethods: { atproto: destSigningKey.did() },
            alsoKnownAs: ['at://catch-up.dest.pds.example'],
            rotationKeys: [destRotKey.did()]
          })
        )
      }
      if (options.url.endsWith('/com.atproto.repo.importRepo')) {
        importRepoCount += 1
        return okResponse(options.url, '')
      }
      if (options.url.includes('/com.atproto.repo.listMissingBlobs')) {
        return okResponse(
          options.url,
          JSON.stringify({
            blobs: uploaded.length === 0 ? [{ cid: blob.cid }] : []
          })
        )
      }
      if (options.url.endsWith('/com.atproto.repo.uploadBlob')) {
        uploaded.push(Buffer.from(options.bodyBytes ?? []).toString('utf8'))
        return okResponse(
          options.url,
          JSON.stringify({ blob: { $type: 'blob' } })
        )
      }
      if (options.url.endsWith('/app.bsky.actor.putPreferences')) {
        preferenceBodies.push(String(options.body ?? ''))
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    const finished = await finishMoveOut({ database, actor, store })

    expect(importRepoCount).toBe(0)
    expect(uploaded).toEqual(['skipped-image'])
    expect(finished.missingBlobs).toBe(0)
    expect(preferenceBodies).toHaveLength(1)
    expect(JSON.parse(preferenceBodies[0])).toEqual({
      preferences: [
        { $type: 'app.bsky.actor.defs#adultContentPref', enabled: false }
      ]
    })
  })

  it('stops copying at its budget, activates, and reports what is still missing', async () => {
    const { actor, did } = await setupHostedAccount('move-finish-budget')
    const store = createMemoryBlobStore()
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()

    const blob = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('slow-image'), mimeType: 'image/png' },
      { store }
    )
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'post',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'one', image: blob.blob }]
        }
      }
    })
    const currentRepo = await database.getPdsRepo({ did })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'budget.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: currentRepo!.rev,
      switchedAt: null
    })

    let now = Date.now()
    let activateCalls = 0
    let uploads = 0
    destHandler = (options) => {
      if (
        options.url.endsWith(
          '/com.atproto.identity.getRecommendedDidCredentials'
        )
      ) {
        return okResponse(
          options.url,
          JSON.stringify({
            services: {
              atproto_pds: {
                type: 'AtprotoPersonalDataServer',
                endpoint: DEST_PDS
              }
            },
            verificationMethods: { atproto: destSigningKey.did() },
            alsoKnownAs: ['at://budget.dest.pds.example'],
            rotationKeys: [destRotKey.did()]
          })
        )
      }
      if (options.url.includes('/com.atproto.repo.listMissingBlobs')) {
        // The count after the budget asks for the protocol's largest page.
        if (options.url.includes('limit=1000')) {
          return okResponse(
            options.url,
            JSON.stringify({
              blobs: ['a', 'b', 'c', 'd'].map((cid) => ({ cid }))
            })
          )
        }
        return okResponse(
          options.url,
          JSON.stringify({ cursor: `c${now}`, blobs: [{ cid: blob.cid }] })
        )
      }
      if (options.url.endsWith('/com.atproto.repo.uploadBlob')) {
        // Each upload spends more than the whole finish budget.
        uploads += 1
        now += 61_000
        return okResponse(
          options.url,
          JSON.stringify({ blob: { $type: 'blob' } })
        )
      }
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        activateCalls += 1
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const finished = await finishMoveOut({ database, actor, store })
    nowSpy.mockRestore()

    expect(uploads).toBe(1)
    expect(activateCalls).toBe(1)
    expect(finished.missingBlobs).toBe(4)
  })

  it.each([
    { username: 'move-finish-stuck', left: 4, copyIncomplete: false },
    // A full count page may have more behind it: the count is a lower bound.
    { username: 'move-finish-stuck-full', left: 1000, copyIncomplete: true }
  ])(
    'counts what is still missing when the destination cursor gets stuck ($left left)',
    async ({ username, left, copyIncomplete }) => {
      const { actor, did } = await setupHostedAccount(username)
      const store = createMemoryBlobStore()
      const destSigningKey = await Secp256k1Keypair.create()
      const destRotKey = await Secp256k1Keypair.create()

      const blob = await uploadPdsBlob(
        database,
        { did, bytes: Buffer.from('slow-image'), mimeType: 'image/png' },
        { store }
      )
      await createPdsRecord(database, {
        did,
        collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post',
          text: 'post',
          createdAt: new Date().toISOString(),
          embed: {
            $type: 'app.bsky.embed.images',
            images: [{ alt: 'one', image: blob.blob }]
          }
        }
      })
      const currentRepo = await database.getPdsRepo({ did })
      await writeStoredBlueskySession(database, did, {
        type: 'move-out',
        pdsUrl: DEST_PDS,
        destDid: DEST_DID,
        handle: 'budget.dest.pds.example',
        accessJwt: 'a',
        refreshJwt: 'r',
        importedRev: currentRepo!.rev,
        switchedAt: null
      })

      let now = Date.now()
      let activateCalls = 0
      let uploads = 0
      destHandler = (options) => {
        if (
          options.url.endsWith(
            '/com.atproto.identity.getRecommendedDidCredentials'
          )
        ) {
          return okResponse(
            options.url,
            JSON.stringify({
              services: {
                atproto_pds: {
                  type: 'AtprotoPersonalDataServer',
                  endpoint: DEST_PDS
                }
              },
              verificationMethods: { atproto: destSigningKey.did() },
              alsoKnownAs: ['at://budget.dest.pds.example'],
              rotationKeys: [destRotKey.did()]
            })
          )
        }
        if (options.url.includes('/com.atproto.repo.listMissingBlobs')) {
          // The count after the budget asks for the protocol's largest page.
          if (options.url.includes('limit=1000')) {
            return okResponse(
              options.url,
              JSON.stringify({
                cursor: `cid-${left - 1}`,
                blobs: Array.from({ length: left }, (_, i) => ({
                  cid: `cid-${i}`
                }))
              })
            )
          }
          return okResponse(
            options.url,
            JSON.stringify({ cursor: 'stuck', blobs: [{ cid: blob.cid }] })
          )
        }
        if (options.url.endsWith('/com.atproto.repo.uploadBlob')) {
          uploads += 1
          return okResponse(
            options.url,
            JSON.stringify({ blob: { $type: 'blob' } })
          )
        }
        if (options.url.endsWith('/com.atproto.server.activateAccount')) {
          activateCalls += 1
          return okResponse(options.url, '')
        }
        return okResponse(options.url, defaultDestBody(options.url))
      }

      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
      const finished = await finishMoveOut({ database, actor, store })
      nowSpy.mockRestore()

      // The second page answers the same cursor: stuck, so the rest is counted.
      expect(uploads).toBe(2)
      expect(activateCalls).toBe(1)
      expect(finished.missingBlobs).toBe(left)
      expect(finished.copyIncomplete).toBe(copyIncomplete)
    }
  )

  it('activates even when the destination refuses the catch-up list', async () => {
    const { actor, did } = await setupHostedAccount('move-finish-list-fails')
    const store = createMemoryBlobStore()
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()

    const blob = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('slow-image'), mimeType: 'image/png' },
      { store }
    )
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'post',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'one', image: blob.blob }]
        }
      }
    })
    const currentRepo = await database.getPdsRepo({ did })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'budget.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: currentRepo!.rev,
      switchedAt: null
    })

    let activateCalls = 0
    destHandler = (options) => {
      if (
        options.url.endsWith(
          '/com.atproto.identity.getRecommendedDidCredentials'
        )
      ) {
        return okResponse(
          options.url,
          JSON.stringify({
            services: {
              atproto_pds: {
                type: 'AtprotoPersonalDataServer',
                endpoint: DEST_PDS
              }
            },
            verificationMethods: { atproto: destSigningKey.did() },
            alsoKnownAs: ['at://budget.dest.pds.example'],
            rotationKeys: [destRotKey.did()]
          })
        )
      }
      if (options.url.includes('/com.atproto.repo.listMissingBlobs')) {
        return okResponse(
          options.url,
          JSON.stringify({ error: 'InternalServerError' }),
          500
        )
      }
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        activateCalls += 1
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    const finished = await finishMoveOut({ database, actor, store })

    expect(activateCalls).toBe(1)
    expect(finished.copyIncomplete).toBe(true)
  })

  it('activates when the destination answers the catch-up list with a bad body', async () => {
    const { actor, did } = await setupHostedAccount('move-finish-list-bad')
    const store = createMemoryBlobStore()
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()

    const blob = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('slow-image'), mimeType: 'image/png' },
      { store }
    )
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'post',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'one', image: blob.blob }]
        }
      }
    })
    const currentRepo = await database.getPdsRepo({ did })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'budget.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: currentRepo!.rev,
      switchedAt: null
    })

    let activateCalls = 0
    destHandler = (options) => {
      if (
        options.url.endsWith(
          '/com.atproto.identity.getRecommendedDidCredentials'
        )
      ) {
        return okResponse(
          options.url,
          JSON.stringify({
            services: {
              atproto_pds: {
                type: 'AtprotoPersonalDataServer',
                endpoint: DEST_PDS
              }
            },
            verificationMethods: { atproto: destSigningKey.did() },
            alsoKnownAs: ['at://budget.dest.pds.example'],
            rotationKeys: [destRotKey.did()]
          })
        )
      }
      if (options.url.includes('/com.atproto.repo.listMissingBlobs')) {
        return okResponse(options.url, JSON.stringify({ blobs: null }))
      }
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        activateCalls += 1
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    const finished = await finishMoveOut({ database, actor, store })

    expect(activateCalls).toBe(1)
    expect(finished.copyIncomplete).toBe(true)
  })

  it('fails the finish for a retry when the destination is rate limiting the catch-up', async () => {
    const { actor, did } = await setupHostedAccount('move-finish-list-429')
    const store = createMemoryBlobStore()
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()

    const blob = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('slow-image'), mimeType: 'image/png' },
      { store }
    )
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'post',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'one', image: blob.blob }]
        }
      }
    })
    const currentRepo = await database.getPdsRepo({ did })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'budget.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: currentRepo!.rev,
      switchedAt: null
    })

    let activateCalls = 0
    destHandler = (options) => {
      if (
        options.url.endsWith(
          '/com.atproto.identity.getRecommendedDidCredentials'
        )
      ) {
        return okResponse(
          options.url,
          JSON.stringify({
            services: {
              atproto_pds: {
                type: 'AtprotoPersonalDataServer',
                endpoint: DEST_PDS
              }
            },
            verificationMethods: { atproto: destSigningKey.did() },
            alsoKnownAs: ['at://budget.dest.pds.example'],
            rotationKeys: [destRotKey.did()]
          })
        )
      }
      if (options.url.includes('/com.atproto.repo.listMissingBlobs')) {
        return okResponse(
          options.url,
          JSON.stringify({ error: 'RateLimitExceeded' }),
          429
        )
      }
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        activateCalls += 1
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    await expect(finishMoveOut({ database, actor, store })).rejects.toThrow()
    expect(activateCalls).toBe(0)
  })

  it('fails the finish for a retry when the catch-up request gets no answer', async () => {
    const { actor, did } = await setupHostedAccount('move-catch-up-unreachable')
    const store = createMemoryBlobStore()
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()

    const blob = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('slow-image'), mimeType: 'image/png' },
      { store }
    )
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'post',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'one', image: blob.blob }]
        }
      }
    })
    const currentRepo = await database.getPdsRepo({ did })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'budget.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: currentRepo!.rev,
      switchedAt: null
    })

    let activateCalls = 0
    destHandler = (options) => {
      if (
        options.url.endsWith(
          '/com.atproto.identity.getRecommendedDidCredentials'
        )
      ) {
        return okResponse(
          options.url,
          JSON.stringify({
            services: {
              atproto_pds: {
                type: 'AtprotoPersonalDataServer',
                endpoint: DEST_PDS
              }
            },
            verificationMethods: { atproto: destSigningKey.did() },
            alsoKnownAs: ['at://budget.dest.pds.example'],
            rotationKeys: [destRotKey.did()]
          })
        )
      }
      if (options.url.includes('/com.atproto.repo.listMissingBlobs')) {
        // No answer at all: a timeout, DNS failure or refused connection.
        throw new Error('socket hang up')
      }
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        activateCalls += 1
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    await expect(finishMoveOut({ database, actor, store })).rejects.toThrow()
    expect(activateCalls).toBe(0)
  })

  it('activates when the destination answers the catch-up with an Unreachable body and a real status', async () => {
    const { actor, did } = await setupHostedAccount(
      'move-catch-up-unreachable-body'
    )
    const store = createMemoryBlobStore()
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()

    const blob = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('slow-image'), mimeType: 'image/png' },
      { store }
    )
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'post',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'one', image: blob.blob }]
        }
      }
    })
    const currentRepo = await database.getPdsRepo({ did })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'budget.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: currentRepo!.rev,
      switchedAt: null
    })

    let activateCalls = 0
    destHandler = (options) => {
      if (
        options.url.endsWith(
          '/com.atproto.identity.getRecommendedDidCredentials'
        )
      ) {
        return okResponse(
          options.url,
          JSON.stringify({
            services: {
              atproto_pds: {
                type: 'AtprotoPersonalDataServer',
                endpoint: DEST_PDS
              }
            },
            verificationMethods: { atproto: destSigningKey.did() },
            alsoKnownAs: ['at://budget.dest.pds.example'],
            rotationKeys: [destRotKey.did()]
          })
        )
      }
      if (options.url.includes('/com.atproto.repo.listMissingBlobs')) {
        // A real status with an "Unreachable" body is not an unreachable
        // server: the destination answered.
        return okResponse(
          options.url,
          JSON.stringify({ error: 'Unreachable' }),
          500
        )
      }
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        activateCalls += 1
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    const finished = await finishMoveOut({ database, actor, store })

    expect(activateCalls).toBe(1)
    expect(finished.copyIncomplete).toBe(true)
  })

  it('copies a blob added after the blobs step when finishing', async () => {
    const { actor, did } = await setupHostedAccount('move-post-switch-blobs')
    const store = createMemoryBlobStore()
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()

    const firstBlob = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('first-image'), mimeType: 'image/png' },
      { store }
    )
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'first post',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'one', image: firstBlob.blob }]
        }
      }
    })

    const currentRepo = await database.getPdsRepo({ did })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'post-switch.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: currentRepo!.rev,
      switchedAt: null
    })

    // A post written after the blobs step brings a blob the destination lacks.
    const lateBlob = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('late-image'), mimeType: 'image/jpeg' },
      { store }
    )
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'late post',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'late', image: lateBlob.blob }]
        }
      }
    })

    const uploaded: string[] = []
    destHandler = (options) => {
      if (
        options.url.endsWith(
          '/com.atproto.identity.getRecommendedDidCredentials'
        )
      ) {
        return okResponse(
          options.url,
          JSON.stringify({
            services: {
              atproto_pds: {
                type: 'AtprotoPersonalDataServer',
                endpoint: DEST_PDS
              }
            },
            verificationMethods: { atproto: destSigningKey.did() },
            alsoKnownAs: ['at://post-switch.dest.pds.example'],
            rotationKeys: [destRotKey.did()]
          })
        )
      }
      if (options.url.endsWith('/com.atproto.repo.importRepo')) {
        return okResponse(options.url, '')
      }
      if (options.url.includes('/com.atproto.repo.listMissingBlobs')) {
        return okResponse(
          options.url,
          JSON.stringify({ blobs: [{ cid: lateBlob.cid }] })
        )
      }
      if (options.url.endsWith('/com.atproto.repo.uploadBlob')) {
        uploaded.push(Buffer.from(options.bodyBytes ?? []).toString('utf8'))
        return okResponse(
          options.url,
          JSON.stringify({ blob: { $type: 'blob' } })
        )
      }
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        return okResponse(options.url, '')
      }
      if (options.url.endsWith('/com.atproto.server.deleteSession')) {
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    const finished = await finishMoveOut({ database, actor, store })

    // The repo is deactivated by the switch, but its blobs still copy.
    expect(uploaded).toEqual(['late-image'])
    expect(finished.missingBlobs).toBe(0)
  })

  it('copies what it can and reports blobs it cannot read after the switch', async () => {
    const { actor, did } = await setupHostedAccount('move-post-switch-missing')
    const store = createMemoryBlobStore()
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()

    const readable = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('readable-image'), mimeType: 'image/png' },
      { store }
    )
    const unreadable = await uploadPdsBlob(
      database,
      { did, bytes: Buffer.from('unreadable-image'), mimeType: 'image/png' },
      { store }
    )
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'two images',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [
            { alt: 'one', image: readable.blob },
            { alt: 'two', image: unreadable.blob }
          ]
        }
      }
    })

    const currentRepo = await database.getPdsRepo({ did })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'post-switch.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: currentRepo!.rev,
      switchedAt: null
    })

    // A post written after the blobs step changes the rev, so the switch
    // re-sends the repo and copies what the destination still lacks.
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'late post',
        createdAt: new Date().toISOString()
      }
    })

    destHandler = (options) => {
      if (
        options.url.endsWith(
          '/com.atproto.identity.getRecommendedDidCredentials'
        )
      ) {
        return okResponse(
          options.url,
          JSON.stringify({
            services: {
              atproto_pds: {
                type: 'AtprotoPersonalDataServer',
                endpoint: DEST_PDS
              }
            },
            verificationMethods: { atproto: destSigningKey.did() },
            alsoKnownAs: ['at://post-switch.dest.pds.example'],
            rotationKeys: [destRotKey.did()]
          })
        )
      }
      if (options.url.endsWith('/com.atproto.repo.importRepo')) {
        return okResponse(options.url, '')
      }
      if (options.url.includes('/com.atproto.repo.listMissingBlobs')) {
        return okResponse(
          options.url,
          JSON.stringify({
            blobs: [{ cid: readable.cid }, { cid: unreadable.cid }]
          })
        )
      }
      if (options.url.endsWith('/com.atproto.repo.uploadBlob')) {
        uploaded.push(Buffer.from(options.bodyBytes ?? []).toString('utf8'))
        return okResponse(
          options.url,
          JSON.stringify({ blob: { $type: 'blob' } })
        )
      }
      if (options.url.endsWith('/com.atproto.server.activateAccount')) {
        return okResponse(options.url, '')
      }
      if (options.url.endsWith('/com.atproto.server.deleteSession')) {
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    const uploaded: string[] = []
    const throwingStore: PdsBlobObjectStore = {
      ...store,
      openRead: async (key) => {
        if (key.includes(unreadable.cid)) throw new Error('disk exploded')
        return store.openRead(key)
      }
    }

    const finished = await finishMoveOut({
      database,
      actor,
      store: throwingStore
    })

    expect(uploaded).toEqual(['readable-image'])
    expect(finished.missingBlobs).toBe(1)
    expect(finished.movedTo).toBe(DEST_HOST)
  })

  it('deletes a copy whose move already switched, revoking the stored move session', async () => {
    const { actor, did, handle } = await setupHostedAccount(
      'move-delete-switched'
    )
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()

    // A crash after the switch: the repo is deactivated and points at the
    // destination, but the move session is still stored.
    await database.updatePdsRepoIdentity({
      did,
      plcOperation: JSON.stringify({
        type: 'plc_operation',
        rotationKeys: [destRotKey.did()],
        verificationMethods: { atproto: destSigningKey.did() },
        alsoKnownAs: ['at://moved.dest.pds.example'],
        services: {
          atproto_pds: {
            type: 'AtprotoPersonalDataServer',
            endpoint: DEST_PDS
          }
        },
        prev: 'bafyprev',
        sig: 'sig'
      })
    })
    await database.updatePdsRepoStatus({ did, status: 'deactivated' })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'moved.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'switched-refresh',
      importedRev: null,
      switchedAt: Date.now()
    })

    const revoked: string[] = []
    destHandler = (options) => {
      const headers = options.headers as Record<string, string>
      if (options.url.endsWith('/com.atproto.server.deleteSession')) {
        revoked.push(headers.Authorization)
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    await deleteHostedBlueskyAccount({
      database,
      actor,
      confirmHandle: handle
    })

    expect(await database.getPdsRepo({ actorId: actor.id })).toBeNull()
    expect(await database.getBlueskySession({ did })).toBeNull()
    expect(revoked).toEqual(['Bearer switched-refresh'])
  })

  it('deletes a copy whose operation already points away though the move never recorded its switch', async () => {
    const { actor, did, handle } = await setupHostedAccount(
      'move-delete-unrecorded'
    )
    const destSigningKey = await Secp256k1Keypair.create()
    const destRotKey = await Secp256k1Keypair.create()

    // A crash after the switch: the repo is deactivated and points at the
    // destination, but the move session is still stored.
    await database.updatePdsRepoIdentity({
      did,
      plcOperation: JSON.stringify({
        type: 'plc_operation',
        rotationKeys: [destRotKey.did()],
        verificationMethods: { atproto: destSigningKey.did() },
        alsoKnownAs: ['at://moved.dest.pds.example'],
        services: {
          atproto_pds: {
            type: 'AtprotoPersonalDataServer',
            endpoint: DEST_PDS
          }
        },
        prev: 'bafyprev',
        sig: 'sig'
      })
    })
    await database.updatePdsRepoStatus({ did, status: 'deactivated' })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'moved.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'switched-refresh',
      importedRev: null,
      switchedAt: null
    })

    const revoked: string[] = []
    destHandler = (options) => {
      const headers = options.headers as Record<string, string>
      if (options.url.endsWith('/com.atproto.server.deleteSession')) {
        revoked.push(headers.Authorization)
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    await deleteHostedBlueskyAccount({
      database,
      actor,
      confirmHandle: handle
    })

    expect(await database.getPdsRepo({ actorId: actor.id })).toBeNull()
    expect(await database.getBlueskySession({ did })).toBeNull()
    expect(revoked).toEqual(['Bearer switched-refresh'])
  })

  it('cancels without the rotation key or an enabled domain', async () => {
    const { actor, did } = await setupHostedAccount('move-cancel-no-key')
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'cancel.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: null,
      switchedAt: null
    })
    delete process.env.ACTIVITIES_BLUESKY_PDS_ROTATION_KEY
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      [TEST_DOMAIN]: {
        enabled: false,
        hostname: PDS_HOSTNAME,
        allowEmails: [],
        allowActors: []
      }
    })
    destHandler = (options) => okResponse(options.url, '')

    const cancelled = await cancelMoveOut({ database, actor })

    expect(cancelled.cancelled).toBe(true)
    expect(await database.getBlueskySession({ did })).toBeNull()
    expect((await database.getPdsRepo({ did }))?.status).toBe('active')
  })

  it('cancels an unswitched move once the PDS config is gone', async () => {
    const { actor, did } = await setupHostedAccount('move-cancel-no-config')
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'cancel.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: null,
      switchedAt: null
    })
    delete process.env.ACTIVITIES_BLUESKY_PDS_ROTATION_KEY
    // With no config (an empty value here; an invalid entry anywhere does the
    // same) this server's origin is unknown, and the directory still points here.
    process.env.ACTIVITIES_BLUESKY_PDS = ''
    destHandler = (options) => okResponse(options.url, '')

    const cancelled = await cancelMoveOut({ database, actor })

    expect(cancelled.cancelled).toBe(true)
    expect(await database.getBlueskySession({ did })).toBeNull()
    expect((await database.getPdsRepo({ did }))?.status).toBe('active')
  })

  it('refuses to cancel without PDS config when the directory already points away', async () => {
    const { actor, did } = await setupHostedAccount(
      'move-cancel-no-config-away'
    )
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'cancel.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: null,
      switchedAt: null
    })
    delete process.env.ACTIVITIES_BLUESKY_PDS_ROTATION_KEY
    process.env.ACTIVITIES_BLUESKY_PDS = ''
    destHandler = (options) => okResponse(options.url, '')
    // The switch landed at the directory but not here.
    const ops = plcOpsByDid.get(did)!
    ops.push({
      ...ops[ops.length - 1],
      services: {
        atproto_pds: { type: 'AtprotoPersonalDataServer', endpoint: DEST_PDS }
      }
    })

    await expect(cancelMoveOut({ database, actor })).rejects.toBeInstanceOf(
      PdsMoveOutSwitchedError
    )
    expect(await database.getBlueskySession({ did })).not.toBeNull()
  })

  it('passes over a blob that fails and hands on the next cursor', async () => {
    const { actor, did } = await setupHostedAccount('move-blob-budget')
    const store = createMemoryBlobStore()
    const blobs: Awaited<ReturnType<typeof uploadPdsBlob>>[] = []
    for (const name of ['one', 'two', 'three']) {
      blobs.push(
        await uploadPdsBlob(
          database,
          { did, bytes: Buffer.from(`budget-${name}`), mimeType: 'image/png' },
          { store }
        )
      )
    }
    await createPdsRecord(database, {
      did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'three blobs',
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: blobs.map((blob, index) => ({
            alt: `image-${index}`,
            image: blob.blob
          }))
        }
      }
    })
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'alice.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: null,
      switchedAt: null
    })

    let uploads = 0
    destHandler = (options) => {
      if (options.url.includes('/com.atproto.repo.listMissingBlobs')) {
        return okResponse(
          options.url,
          JSON.stringify({
            cursor: 'next',
            blobs: blobs.map((blob) => ({ cid: blob.cid }))
          })
        )
      }
      if (options.url.endsWith('/com.atproto.repo.uploadBlob')) {
        uploads += 1
        // The first upload fails; the batch goes on with the others.
        if (uploads === 1) {
          return okResponse(
            options.url,
            JSON.stringify({ error: 'InternalServerError' }),
            500
          )
        }
        return okResponse(
          options.url,
          JSON.stringify({ blob: { $type: 'blob' } })
        )
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    const batch = await copyMoveOutBlobs({ database, actor, store })

    // The failed blob is reported and the cursor moves on past it, so the
    // next page never retries it.
    expect(batch).toMatchObject({ copied: 2, cursor: 'next', done: false })
    expect(batch.failed).toHaveLength(1)
    expect(uploads).toBe(3)
  })

  it('refuses a move step when the actor was suspended after it was loaded', async () => {
    const { actor, did } = await setupHostedAccount('move-stale-actor')
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'alice.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: null,
      switchedAt: null
    })
    // The caller's actor object still says active; the row does not.
    await testDb
      .db!.updateTable('actors')
      .set({ suspendedAt: new Date() })
      .where('id', '=', actor.id)
      .execute()

    await expect(sendMoveOutRepo({ database, actor })).rejects.toBeInstanceOf(
      PdsHostedAccountInactiveError
    )
  })

  it('refuses to finish before the posts are copied', async () => {
    const { actor, did } = await setupHostedAccount('move-not-copied')
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'alice.dest.pds.example',
      accessJwt: 'a',
      refreshJwt: 'r',
      importedRev: null,
      switchedAt: null
    })
    const plcCountBefore = plcOpsByDid.get(did)!.length

    await expect(finishMoveOut({ database, actor })).rejects.toMatchObject({
      code: 'MoveOutNotCopied',
      statusCode: 409,
      message: 'Copy your posts first.'
    })
    expect(plcOpsByDid.get(did)!.length).toBe(plcCountBefore)
  })

  it('revokes the refresh token a rotation left in the stored move when cancelling', async () => {
    const { actor, did } = await setupHostedAccount('move-cancel-rotated')
    await writeStoredBlueskySession(database, did, {
      type: 'move-out',
      pdsUrl: DEST_PDS,
      destDid: DEST_DID,
      handle: 'cancel.dest.pds.example',
      accessJwt: 'old-access',
      refreshJwt: 'old-refresh',
      importedRev: null,
      switchedAt: null
    })

    const revoked: string[] = []
    destHandler = (options) => {
      const headers = options.headers as Record<string, string>
      if (options.url.endsWith('/com.atproto.server.checkAccountStatus')) {
        if (headers.Authorization === 'Bearer old-access') {
          return okResponse(
            options.url,
            JSON.stringify({ error: 'ExpiredToken', message: 'Expired' }),
            401
          )
        }
        return okResponse(options.url, JSON.stringify({ activated: false }))
      }
      if (options.url.endsWith('/com.atproto.server.refreshSession')) {
        return okResponse(
          options.url,
          JSON.stringify({
            did,
            accessJwt: 'new-access',
            refreshJwt: 'new-refresh'
          })
        )
      }
      if (options.url.endsWith('/com.atproto.server.deleteSession')) {
        revoked.push(headers.Authorization)
        return okResponse(options.url, '')
      }
      return okResponse(options.url, defaultDestBody(options.url))
    }

    // The directory read inside cancel runs a refresh first, rotating the
    // stored tokens after cancel read its copy of the move.
    const base = vi.mocked(safeRemoteFetch).getMockImplementation()!
    let rotated = false
    vi.mocked(safeRemoteFetch).mockImplementation(async (options) => {
      const parsed = new URL(options.url)
      if (
        parsed.origin === PLC_DIRECTORY &&
        options.method === 'GET' &&
        !rotated
      ) {
        rotated = true
        await getMoveOutProgress({ database, actor })
      }
      return base(options)
    })

    await cancelMoveOut({ database, actor })

    expect(revoked).toEqual(['Bearer new-refresh'])
  })
})
