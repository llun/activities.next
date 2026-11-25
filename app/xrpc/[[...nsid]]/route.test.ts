import { Secp256k1Keypair } from '@atproto/crypto'
import { parseCid } from '@atproto/lex-data'
import {
  MemoryBlockstore,
  Repo,
  readCar,
  readCarWithRoot,
  verifyDiffCar,
  verifyProofs,
  verifyRepoCar
} from '@atproto/repo'
import { trace } from '@opentelemetry/api'
import { NextRequest } from 'next/server'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { getConfig } from '@/lib/config'
import { MediaStorageType } from '@/lib/config/mediaStorage'
import { resetTrustProxyIpHeadersConfigCacheForTests } from '@/lib/config/trustProxyIpHeaders'
import { getDatabase } from '@/lib/database'
import { APP_RATE_LIMIT_KEY_PREFIX } from '@/lib/database/domains/rateLimit/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import {
  SERVED_DOMAIN_REFRESH_MS,
  refreshServedDomains,
  resetServedDomainsForTests,
  setServedDomainsForTests
} from '@/lib/services/domains/servedDomainSnapshot'
import {
  FilePdsBlobObjectStore,
  PDS_REPO_READ_RATE_LIMIT,
  PDS_SYNC_BLOB_RATE_LIMIT,
  PDS_SYNC_RATE_LIMIT,
  XRPC_VARY_HEADER,
  createPdsRecord,
  createPdsRepo,
  getPdsRepoCar,
  uploadPdsBlob
} from '@/lib/services/pds'
import { MOCK_SECRET_PHASES } from '@/lib/stub/actor'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { createRecordingTracerProvider } from '@/lib/testing/recordingTracer'
import { STRICT_TRANSPORT_SECURITY_HEADER } from '@/lib/utils/http-headers/hsts'

import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from './route'

vi.mock('@/lib/database', () => ({ getDatabase: vi.fn() }))

const DOMAIN_A = TEST_DOMAIN
const PDS_HOST_A = `pds.${DOMAIN_A}`
const DOMAIN_B = 'second.test'
const PDS_HOST_B = `pds.${DOMAIN_B}`
const DISABLED_DOMAIN = 'disabled.test'
const DISABLED_PDS_HOST = `pds.${DISABLED_DOMAIN}`

const PDS_ENV = JSON.stringify({
  [DOMAIN_A]: {
    enabled: true,
    hostname: PDS_HOST_A,
    allowEmails: [],
    allowActors: [
      `alicepds@${DOMAIN_A}`,
      `bobpds@${DOMAIN_A}`,
      `deactpds@${DOMAIN_A}`,
      `tdpds@${DOMAIN_A}`,
      `oldhandle@${DOMAIN_A}`
    ]
  },
  [DOMAIN_B]: {
    enabled: true,
    hostname: PDS_HOST_B,
    allowEmails: [],
    allowActors: [`otherpds@${DOMAIN_B}`]
  },
  [DISABLED_DOMAIN]: {
    enabled: false,
    hostname: DISABLED_PDS_HOST,
    allowEmails: [],
    allowActors: []
  }
})

const KEY_A_BYTES = Buffer.from(
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'hex'
)
const KEY_B_BYTES = Buffer.from(
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
  'hex'
)

const DID_A = 'did:web:alice.pds.test'
const DID_A2 = 'did:web:bob.pds.test'
const DID_DEACTIVATED = 'did:web:deactivated.pds.test'
const DID_TAKENDOWN = 'did:web:takendown.pds.test'
const DID_B = 'did:web:other.second.test'

type XrpcRequestOpts = {
  host?: string
  protocol?: 'https' | 'http'
  urlHost?: string
  query?: string
  method?: string
  headers?: Record<string, string>
}

const makeXrpcRequest = (
  nsidPath: string | string[] | undefined,
  {
    host = PDS_HOST_A,
    protocol = 'https',
    urlHost,
    query,
    method = 'GET',
    headers = {}
  }: XrpcRequestOpts = {}
) => {
  const qs = query ? `?${query}` : ''
  const urlPath =
    nsidPath === undefined
      ? '/xrpc'
      : Array.isArray(nsidPath)
        ? nsidPath.length === 0
          ? '/xrpc/'
          : `/xrpc/${nsidPath.join('/')}`
        : `/xrpc/${nsidPath}`
  return new NextRequest(`${protocol}://${urlHost ?? host}${urlPath}${qs}`, {
    method,
    headers: { host, ...headers }
  })
}

const toSegments = (
  nsidPath: string | string[] | undefined
): string[] | undefined => {
  if (nsidPath === undefined) return undefined
  return Array.isArray(nsidPath) ? nsidPath : [nsidPath]
}

const callGet = (
  nsidPath: string | string[] | undefined,
  opts?: XrpcRequestOpts
) =>
  GET(makeXrpcRequest(nsidPath, opts), {
    params: Promise.resolve({ nsid: toSegments(nsidPath) })
  })

const callHead = (
  nsidPath: string | string[] | undefined,
  opts?: XrpcRequestOpts
) =>
  HEAD(makeXrpcRequest(nsidPath, { ...opts, method: 'HEAD' }), {
    params: Promise.resolve({ nsid: toSegments(nsidPath) })
  })

const callPost = (
  nsidPath: string | string[] | undefined,
  opts?: XrpcRequestOpts
) =>
  POST(makeXrpcRequest(nsidPath, { ...opts, method: 'POST' }), {
    params: Promise.resolve({ nsid: toSegments(nsidPath) })
  })

const callOptions = (
  nsidPath: string | string[] | undefined,
  opts?: XrpcRequestOpts
) =>
  OPTIONS(makeXrpcRequest(nsidPath, { ...opts, method: 'OPTIONS' }), {
    params: Promise.resolve({ nsid: toSegments(nsidPath) })
  })

const readResponseBytes = async (response: Response): Promise<Uint8Array> =>
  new Uint8Array(await response.arrayBuffer())

describe('XRPC PDS routes (/xrpc/[[...nsid]])', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  const originalPdsEnv = process.env.ACTIVITIES_BLUESKY_PDS
  const originalTrustProxyEnv = process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS

  let tempDir: string
  let fileStore: FilePdsBlobObjectStore
  let keyA: Secp256k1Keypair
  let keyB: Secp256k1Keypair

  let post1Uri: string
  let post1Cid: string
  let post1Rkey: string
  let post1Rev: string
  let repoAtPost1: Repo
  let post2Rkey: string
  let post2Cid: string
  let latestCommitA: { cid: string; rev: string }

  let pngBlobBytes: Buffer
  let pngBlobCid: string
  let htmlBlobBytes: Buffer
  let htmlBlobCid: string
  let svgBlobBytes: Buffer
  let svgBlobCid: string

  let postBCid: string
  let postBRkey: string
  let blobBCid: string

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pds-xrpc-test-'))
    fileStore = new FilePdsBlobObjectStore({
      type: MediaStorageType.LocalFile,
      path: tempDir
    })
    keyA = await Secp256k1Keypair.import(KEY_A_BYTES, { exportable: true })
    keyB = await Secp256k1Keypair.import(KEY_B_BYTES, { exportable: true })

    process.env.ACTIVITIES_BLUESKY_PDS = PDS_ENV

    // Create local actors so handle resolution & describeRepo work end-to-end
    await database.createAccount({
      email: 'alice-pds@test.local',
      username: 'alicepds',
      domain: DOMAIN_A,
      passwordHash: TEST_PASSWORD_HASH,
      privateKey: 'priv-a',
      publicKey: 'pub-a'
    })
    const actorA = `https://${DOMAIN_A}/users/alicepds`
    await database.createAccount({
      email: 'bob-pds@test.local',
      username: 'bobpds',
      domain: DOMAIN_A,
      passwordHash: TEST_PASSWORD_HASH,
      privateKey: 'priv-a2',
      publicKey: 'pub-a2'
    })
    const actorA2 = `https://${DOMAIN_A}/users/bobpds`
    await database.createAccount({
      email: 'deact-pds@test.local',
      username: 'deactpds',
      domain: DOMAIN_A,
      passwordHash: TEST_PASSWORD_HASH,
      privateKey: 'priv-d',
      publicKey: 'pub-d'
    })
    const actorDeactivated = `https://${DOMAIN_A}/users/deactpds`
    await database.createAccount({
      email: 'td-pds@test.local',
      username: 'tdpds',
      domain: DOMAIN_A,
      passwordHash: TEST_PASSWORD_HASH,
      privateKey: 'priv-t',
      publicKey: 'pub-t'
    })
    const actorTakendown = `https://${DOMAIN_A}/users/tdpds`
    await database.createAccount({
      email: 'other-pds@second.test',
      username: 'otherpds',
      domain: DOMAIN_B,
      passwordHash: TEST_PASSWORD_HASH,
      privateKey: 'priv-b',
      publicKey: 'pub-b'
    })
    const actorB = `https://${DOMAIN_B}/users/otherpds`

    // Repo A (active, with blobs and multiple records)
    await createPdsRepo(database, {
      did: DID_A,
      actorId: actorA,
      domain: DOMAIN_A,
      signingKey: keyA
    })

    pngBlobBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03
    ])
    const pngUpload = await uploadPdsBlob(
      database,
      { did: DID_A, bytes: pngBlobBytes, mimeType: 'image/png' },
      { store: fileStore }
    )
    pngBlobCid = pngUpload.cid

    htmlBlobBytes = Buffer.from('<html><script>alert(1)</script></html>')
    const htmlUpload = await uploadPdsBlob(
      database,
      { did: DID_A, bytes: htmlBlobBytes, mimeType: 'text/html' },
      { store: fileStore }
    )
    htmlBlobCid = htmlUpload.cid

    svgBlobBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')
    const svgUpload = await uploadPdsBlob(
      database,
      { did: DID_A, bytes: svgBlobBytes, mimeType: 'image/svg+xml' },
      { store: fileStore }
    )
    svgBlobCid = svgUpload.cid

    post1Rkey = '3kpost0000001'
    const rec1 = await createPdsRecord(database, {
      did: DID_A,
      collection: 'app.bsky.feed.post',
      rkey: post1Rkey,
      record: {
        $type: 'app.bsky.feed.post',
        text: 'Hello from embedded PDS #1',
        createdAt: '2026-11-24T10:00:00.000Z',
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'png', image: pngUpload.blob }]
        }
      }
    })
    post1Uri = rec1.uri
    post1Cid = rec1.cid
    post1Rev = rec1.commit.rev

    const carAtPost1 = await getPdsRepoCar(database, { did: DID_A })
    const parsedAtPost1 = await readCarWithRoot(carAtPost1)
    repoAtPost1 = await Repo.load(
      new MemoryBlockstore(parsedAtPost1.blocks),
      parsedAtPost1.root
    )

    post2Rkey = '3kpost0000002'
    const rec2 = await createPdsRecord(database, {
      did: DID_A,
      collection: 'app.bsky.feed.post',
      rkey: post2Rkey,
      record: {
        $type: 'app.bsky.feed.post',
        text: 'Hello from embedded PDS #2',
        createdAt: '2026-11-24T10:05:00.000Z',
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'html', image: htmlUpload.blob }]
        }
      }
    })
    post2Cid = rec2.cid
    latestCommitA = rec2.commit

    // Link SVG blob so getBlob serves it (unreferenced blobs return 400)
    await createPdsRecord(database, {
      did: DID_A,
      collection: 'app.bsky.feed.post',
      rkey: '3kpost0000003',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'Hello from embedded PDS #3',
        createdAt: '2026-11-24T10:06:00.000Z',
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'svg', image: svgUpload.blob }]
        }
      }
    })
    const latest = await database.getPdsRepo({ did: DID_A })
    latestCommitA = { cid: latest!.rootCid!, rev: latest!.rev! }

    // Second active repo on Domain A for listRepos pagination
    await createPdsRepo(database, {
      did: DID_A2,
      actorId: actorA2,
      domain: DOMAIN_A,
      signingKey: keyA
    })

    // Deactivated repo on Domain A
    await createPdsRepo(database, {
      did: DID_DEACTIVATED,
      actorId: actorDeactivated,
      domain: DOMAIN_A,
      signingKey: keyA
    })
    await database.updatePdsRepoStatus({
      did: DID_DEACTIVATED,
      status: 'deactivated'
    })

    // Taken-down repo on Domain A
    await createPdsRepo(database, {
      did: DID_TAKENDOWN,
      actorId: actorTakendown,
      domain: DOMAIN_A,
      signingKey: keyA
    })
    await database.updatePdsRepoStatus({
      did: DID_TAKENDOWN,
      status: 'takendown'
    })

    // Repo on Domain B (must be invisible on PDS_HOST_A)
    await createPdsRepo(database, {
      did: DID_B,
      actorId: actorB,
      domain: DOMAIN_B,
      signingKey: keyB
    })
    const blobBUpload = await uploadPdsBlob(
      database,
      {
        did: DID_B,
        bytes: Buffer.from('domain-b-blob'),
        mimeType: 'text/plain'
      },
      { store: fileStore }
    )
    blobBCid = blobBUpload.cid
    postBRkey = '3kpostb000001'
    const recB = await createPdsRecord(database, {
      did: DID_B,
      collection: 'app.bsky.feed.post',
      rkey: postBRkey,
      record: {
        $type: 'app.bsky.feed.post',
        text: 'Domain B secret post',
        createdAt: '2026-11-24T11:00:00.000Z'
      }
    })
    postBCid = recB.cid
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetServedDomainsForTests()
    setServedDomainsForTests([])
    process.env.ACTIVITIES_BLUESKY_PDS = PDS_ENV
    delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS
    resetTrustProxyIpHeadersConfigCacheForTests()
    vi.mocked(getDatabase).mockReturnValue(database)
    vi.mocked(getConfig).mockReturnValue({
      serviceName: 'activities.next',
      host: TEST_DOMAIN,
      secretPhase: MOCK_SECRET_PHASES,
      email: { serviceFromAddress: 'test@llun.dev' },
      database: {
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename: ':memory:' }
      },
      mediaStorage: {
        type: MediaStorageType.LocalFile,
        path: tempDir
      }
    } as ReturnType<typeof getConfig>)
  })

  afterEach(() => {
    vi.useRealTimers()
    resetServedDomainsForTests()
  })

  afterAll(async () => {
    resetServedDomainsForTests()
    if (originalPdsEnv === undefined) {
      delete process.env.ACTIVITIES_BLUESKY_PDS
    } else {
      process.env.ACTIVITIES_BLUESKY_PDS = originalPdsEnv
    }
    if (originalTrustProxyEnv === undefined) {
      delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS
    } else {
      process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS = originalTrustProxyEnv
    }
    resetTrustProxyIpHeadersConfigCacheForTests()
    await fs.rm(tempDir, { recursive: true, force: true })
    await database.destroy()
  })

  describe('host gating, catch-all path safety, and 404 isolation', () => {
    const ALL_NSIDS = [
      'com.atproto.server.describeServer',
      'com.atproto.repo.describeRepo',
      'com.atproto.repo.getRecord',
      'com.atproto.repo.listRecords',
      'com.atproto.sync.getRepo',
      'com.atproto.sync.getRecord',
      'com.atproto.sync.getBlocks',
      'com.atproto.sync.getLatestCommit',
      'com.atproto.sync.getRepoStatus',
      'com.atproto.sync.listRepos',
      'com.atproto.sync.listBlobs',
      'com.atproto.sync.getBlob',
      'com.atproto.repo.createRecord',
      'com.atproto.server.createSession',
      'com.example.unknown'
    ]

    it.each([
      { label: 'primary domain', host: DOMAIN_A },
      { label: 'disabled PDS host', host: DISABLED_PDS_HOST },
      { label: 'unknown host', host: 'evil.example' }
    ])(
      'answers 404 without touching the database on $label for all endpoints',
      async ({ host }) => {
        for (const nsid of ALL_NSIDS) {
          const getRes = await callGet(nsid, { host })
          expect(getRes.status).toBe(404)
          expect(getRes.headers.get('Cache-Control')).toBe('no-store')
          expect(getRes.headers.get('Vary')).toBe(XRPC_VARY_HEADER)
          expect(getRes.headers.get(STRICT_TRANSPORT_SECURITY_HEADER.key)).toBe(
            STRICT_TRANSPORT_SECURITY_HEADER.value
          )

          const headRes = await callHead(nsid, { host })
          expect(headRes.status).toBe(404)
          expect(headRes.body).toBeNull()

          const postRes = await callPost(nsid, { host })
          expect(postRes.status).toBe(404)

          const optRes = await callOptions(nsid, { host })
          expect(optRes.status).toBe(404)
        }

        const putRes = await PUT(
          makeXrpcRequest('com.atproto.repo.createRecord', {
            host,
            method: 'PUT'
          }),
          {
            params: Promise.resolve({ nsid: ['com.atproto.repo.createRecord'] })
          }
        )
        expect(putRes.status).toBe(404)
        const delRes = await DELETE(
          makeXrpcRequest('com.atproto.repo.deleteRecord', {
            host,
            method: 'DELETE'
          }),
          {
            params: Promise.resolve({ nsid: ['com.atproto.repo.deleteRecord'] })
          }
        )
        expect(delRes.status).toBe(404)
        const patchRes = await PATCH(
          makeXrpcRequest('com.atproto.repo.putRecord', {
            host,
            method: 'PATCH'
          }),
          { params: Promise.resolve({ nsid: ['com.atproto.repo.putRecord'] }) }
        )
        expect(patchRes.status).toBe(404)

        expect(getDatabase).not.toHaveBeenCalled()
      }
    )

    it('catches multi-segment /xrpc/a/b paths with JSON 404 on non-PDS hosts and XRPC 404 on PDS hosts', async () => {
      // Non-PDS host -> plain JSON 404 (no CORS headers)
      const nonPdsRes = await callGet(['a', 'b'], { host: DOMAIN_A })
      expect(nonPdsRes.status).toBe(404)
      expect(nonPdsRes.headers.get('Content-Type')).toBe(
        'application/json; charset=utf-8'
      )
      expect(nonPdsRes.headers.get('Access-Control-Allow-Origin')).toBeNull()
      expect(nonPdsRes.headers.get('Cache-Control')).toBe('no-store')
      expect(nonPdsRes.headers.get('Vary')).toBe(XRPC_VARY_HEADER)
      expect(nonPdsRes.headers.get(STRICT_TRANSPORT_SECURITY_HEADER.key)).toBe(
        STRICT_TRANSPORT_SECURITY_HEADER.value
      )
      expect(await nonPdsRes.json()).toEqual({ error: 'Not Found' })

      // Enabled PDS host -> XRPC 404 for GET, HEAD, POST, OPTIONS, PUT, DELETE, PATCH
      const pdsGet = await callGet(['a', 'b'])
      expect(pdsGet.status).toBe(404)
      expect(pdsGet.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(pdsGet.headers.get('Cache-Control')).toBe('no-store')
      expect(pdsGet.headers.get('Vary')).toBe(XRPC_VARY_HEADER)
      expect(await pdsGet.json()).toEqual({
        error: 'InvalidRequest',
        message: 'Not Found'
      })

      const pdsHead = await callHead([
        'com.atproto.server.describeServer',
        'extra'
      ])
      expect(pdsHead.status).toBe(404)
      expect(pdsHead.body).toBeNull()

      const pdsPost = await callPost(['a', 'b'])
      expect(pdsPost.status).toBe(404)

      const pdsOpt = await callOptions(['a', 'b'])
      expect(pdsOpt.status).toBe(404)

      const pdsPut = await PUT(makeXrpcRequest(['a', 'b'], { method: 'PUT' }), {
        params: Promise.resolve({ nsid: ['a', 'b'] })
      })
      expect(pdsPut.status).toBe(404)

      expect(getDatabase).not.toHaveBeenCalled()
    })

    it.each([
      { label: 'bare /xrpc', nsidPath: undefined as string[] | undefined },
      { label: 'trailing slash /xrpc/', nsidPath: [] as string[] }
    ])(
      'answers JSON 404 on non-PDS hosts and XRPC 404 on PDS hosts for $label across GET, POST, and OPTIONS',
      async ({ nsidPath }) => {
        // Non-PDS host -> JSON 404 (no CORS headers)
        for (const call of [callGet, callPost, callOptions]) {
          const res = await call(nsidPath, { host: DOMAIN_A })
          expect(res.status).toBe(404)
          expect(res.headers.get('Content-Type')).toBe(
            'application/json; charset=utf-8'
          )
          expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
          expect(res.headers.get('Cache-Control')).toBe('no-store')
          expect(res.headers.get('Vary')).toBe(XRPC_VARY_HEADER)
          expect(res.headers.get(STRICT_TRANSPORT_SECURITY_HEADER.key)).toBe(
            STRICT_TRANSPORT_SECURITY_HEADER.value
          )
          expect(await res.json()).toEqual({ error: 'Not Found' })
        }

        // Enabled PDS host -> XRPC 404 (with CORS headers)
        for (const call of [callGet, callPost, callOptions]) {
          const res = await call(nsidPath)
          expect(res.status).toBe(404)
          expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
          expect(res.headers.get('Cache-Control')).toBe('no-store')
          expect(res.headers.get('Vary')).toBe(XRPC_VARY_HEADER)
          expect(res.headers.get(STRICT_TRANSPORT_SECURITY_HEADER.key)).toBe(
            STRICT_TRANSPORT_SECURITY_HEADER.value
          )
          expect(await res.json()).toEqual({
            error: 'InvalidRequest',
            message: 'Not Found'
          })
        }

        const headRes = await callHead(nsidPath)
        expect(headRes.status).toBe(404)
        expect(headRes.body).toBeNull()

        expect(getDatabase).not.toHaveBeenCalled()
      }
    )

    it('fails closed when served-domain snapshot is unloaded and refreshes on OPTIONS and unsupported methods', async () => {
      vi.useFakeTimers()

      // Unloaded snapshot -> every method fails closed with 404.
      resetServedDomainsForTests()
      expect((await callGet('com.atproto.server.describeServer')).status).toBe(
        404
      )
      expect((await callPost('com.atproto.repo.createRecord')).status).toBe(404)
      expect(
        (await callOptions('com.atproto.server.describeServer')).status
      ).toBe(404)
      for (const [method, handler] of [
        ['PUT', PUT],
        ['DELETE', DELETE],
        ['PATCH', PATCH]
      ] as const) {
        const res = await handler(
          makeXrpcRequest('com.atproto.server.describeServer', { method }),
          {
            params: Promise.resolve({
              nsid: ['com.atproto.server.describeServer']
            })
          }
        )
        expect(res.status).toBe(404)
      }

      // Register a DB whose active domains later include PDS_HOST_A.
      const activeDomains: Array<{ domain: string }> = []
      const getActiveServedDomains = vi.fn(async () => activeDomains)
      const mockDb = { getActiveServedDomains } as unknown as Database
      await refreshServedDomains(mockDb)

      expect(
        (await callOptions('com.atproto.server.describeServer')).status
      ).toBe(204)
      expect(
        (
          await PUT(
            makeXrpcRequest('com.atproto.server.describeServer', {
              method: 'PUT'
            }),
            {
              params: Promise.resolve({
                nsid: ['com.atproto.server.describeServer']
              })
            }
          )
        ).status
      ).toBe(405)

      // Add a colliding served domain and advance past refresh interval:
      // OPTIONS and PUT/DELETE/PATCH must refresh before resolving the PDS host.
      activeDomains.push({ domain: PDS_HOST_A })
      vi.advanceTimersByTime(SERVED_DOMAIN_REFRESH_MS + 1)

      expect(
        (await callOptions('com.atproto.server.describeServer')).status
      ).toBe(404)
      expect(getActiveServedDomains).toHaveBeenCalledTimes(2)

      // Reset to non-colliding, refresh, then collide again and verify PUT triggers refresh.
      activeDomains.length = 0
      vi.advanceTimersByTime(SERVED_DOMAIN_REFRESH_MS + 1)
      expect(
        (await callOptions('com.atproto.server.describeServer')).status
      ).toBe(204)
      expect(getActiveServedDomains).toHaveBeenCalledTimes(3)

      activeDomains.push({ domain: PDS_HOST_A })
      vi.advanceTimersByTime(SERVED_DOMAIN_REFRESH_MS + 1)
      expect(
        (
          await PUT(
            makeXrpcRequest('com.atproto.server.describeServer', {
              method: 'PUT'
            }),
            {
              params: Promise.resolve({
                nsid: ['com.atproto.server.describeServer']
              })
            }
          )
        ).status
      ).toBe(404)
      expect(getActiveServedDomains).toHaveBeenCalledTimes(4)
    })

    it('answers 404 without touching the database when ACTIVITIES_BLUESKY_PDS is unset', async () => {
      delete process.env.ACTIVITIES_BLUESKY_PDS
      for (const nsid of ALL_NSIDS) {
        const res = await callGet(nsid, { host: PDS_HOST_A })
        expect(res.status).toBe(404)
      }
      expect(getDatabase).not.toHaveBeenCalled()
    })

    it('answers 404 without refreshing served domains on OPTIONS and unsupported methods when ACTIVITIES_BLUESKY_PDS is unset', async () => {
      vi.useFakeTimers()
      const getActiveServedDomains = vi.fn(async () => [])
      const mockDb = { getActiveServedDomains } as unknown as Database
      await refreshServedDomains(mockDb)
      expect(getActiveServedDomains).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(SERVED_DOMAIN_REFRESH_MS + 1)
      delete process.env.ACTIVITIES_BLUESKY_PDS

      expect(
        (await callOptions('com.atproto.server.describeServer')).status
      ).toBe(404)
      for (const [method, handler] of [
        ['PUT', PUT],
        ['DELETE', DELETE],
        ['PATCH', PATCH]
      ] as const) {
        const res = await handler(
          makeXrpcRequest('com.atproto.server.describeServer', { method }),
          {
            params: Promise.resolve({
              nsid: ['com.atproto.server.describeServer']
            })
          }
        )
        expect(res.status).toBe(404)
      }
      expect(getActiveServedDomains).toHaveBeenCalledTimes(1)
    })
  })

  describe('CORS, HSTS, Cache-Control, and Vary headers', () => {
    it('emits no-store, Vary, and HSTS on HTTPS OPTIONS and omits HSTS on HTTP or localhost', async () => {
      const optRes = await callOptions('com.atproto.server.describeServer')
      expect(optRes.status).toBe(204)
      expect(optRes.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(optRes.headers.get('Access-Control-Allow-Methods')).toContain(
        'POST'
      )
      expect(optRes.headers.get('Cache-Control')).toBe('no-store')
      expect(optRes.headers.get('Vary')).toBe(XRPC_VARY_HEADER)
      expect(optRes.headers.get(STRICT_TRANSPORT_SECURITY_HEADER.key)).toBe(
        STRICT_TRANSPORT_SECURITY_HEADER.value
      )

      const httpRes = await callGet('com.atproto.server.describeServer', {
        protocol: 'http'
      })
      expect(httpRes.status).toBe(200)
      expect(
        httpRes.headers.get(STRICT_TRANSPORT_SECURITY_HEADER.key)
      ).toBeNull()
      expect(httpRes.headers.get('Cache-Control')).toBe('no-store')
      expect(httpRes.headers.get('Vary')).toBe(XRPC_VARY_HEADER)

      const localhostRes = await callGet('com.atproto.server.describeServer', {
        protocol: 'https',
        urlHost: 'localhost'
      })
      expect(localhostRes.status).toBe(200)
      expect(
        localhostRes.headers.get(STRICT_TRANSPORT_SECURITY_HEADER.key)
      ).toBeNull()
    })
  })

  describe('com.atproto.server.describeServer', () => {
    it('returns minimal server description for the requested PDS hostname', async () => {
      const res = await callGet('com.atproto.server.describeServer')
      expect(res.status).toBe(200)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(res.headers.get('Vary')).toBe(XRPC_VARY_HEADER)
      expect(res.headers.get(STRICT_TRANSPORT_SECURITY_HEADER.key)).toBe(
        STRICT_TRANSPORT_SECURITY_HEADER.value
      )
      expect(await res.json()).toEqual({
        did: `did:web:${PDS_HOST_A}`,
        availableUserDomains: [],
        inviteCodeRequired: true
      })
      expect(getDatabase).not.toHaveBeenCalled()
    })

    it('answers HEAD without a body', async () => {
      const res = await callHead('com.atproto.server.describeServer')
      expect(res.status).toBe(200)
      expect(res.body).toBeNull()
      expect(Number(res.headers.get('Content-Length'))).toBeGreaterThan(0)
    })
  })

  describe('com.atproto.repo.* read endpoints', () => {
    it('describeRepo returns repo description by DID and by handle', async () => {
      const byDid = await callGet('com.atproto.repo.describeRepo', {
        query: `repo=${encodeURIComponent(DID_A)}`
      })
      expect(byDid.status).toBe(200)
      const body = await byDid.json()
      expect(body.did).toBe(DID_A)
      expect(body.handle).toBe(`alicepds.${DOMAIN_A}`)
      expect(body.handleIsCorrect).toBe(true)
      expect(body.collections).toEqual(['app.bsky.feed.post'])
      expect(body.didDoc.id).toBe(DID_A)

      const byHandle = await callGet('com.atproto.repo.describeRepo', {
        query: `repo=${encodeURIComponent(`alicepds.${DOMAIN_A}`)}`
      })
      expect(byHandle.status).toBe(200)
      expect((await byHandle.json()).did).toBe(DID_A)
    })

    it('refuses retired actor handles on describeRepo, getRecord, and listRecords while resolving the current handle', async () => {
      const renamedDid = 'did:web:retired-handle-route.pds.test'
      await database.createAccount({
        email: 'oldhandle-route@test.local',
        username: 'oldhandle',
        domain: DOMAIN_A,
        passwordHash: TEST_PASSWORD_HASH,
        privateKey: 'priv-old',
        publicKey: 'pub-old'
      })
      const renamedActorId = `https://${DOMAIN_A}/users/oldhandle`
      await createPdsRepo(database, {
        did: renamedDid,
        actorId: renamedActorId,
        domain: DOMAIN_A,
        signingKey: keyA
      })
      const rec = await createPdsRecord(database, {
        did: renamedDid,
        collection: 'app.bsky.feed.post',
        rkey: '3kretired0001',
        record: {
          $type: 'app.bsky.feed.post',
          text: 'post before rename',
          createdAt: '2026-11-24T12:00:00.000Z'
        }
      })

      const renamed = await database.recordActorHandleRename({
        actorId: renamedActorId,
        username: 'newhandle',
        domain: DOMAIN_A,
        now: new Date(),
        cooldownMs: 0
      })
      expect(renamed.ok).toBe(true)

      const retiredHandle = `oldhandle.${DOMAIN_A}`
      const currentHandle = `newhandle.${DOMAIN_A}`

      const retiredDescribe = await callGet('com.atproto.repo.describeRepo', {
        query: `repo=${encodeURIComponent(retiredHandle)}`
      })
      expect(retiredDescribe.status).toBe(400)
      expect((await retiredDescribe.json()).error).toBe('RepoNotFound')

      const retiredGetRecord = await callGet('com.atproto.repo.getRecord', {
        query: new URLSearchParams({
          repo: retiredHandle,
          collection: 'app.bsky.feed.post',
          rkey: '3kretired0001'
        }).toString()
      })
      expect(retiredGetRecord.status).toBe(400)
      expect((await retiredGetRecord.json()).error).toBe('RepoNotFound')

      const retiredListRecords = await callGet('com.atproto.repo.listRecords', {
        query: new URLSearchParams({
          repo: retiredHandle,
          collection: 'app.bsky.feed.post'
        }).toString()
      })
      expect(retiredListRecords.status).toBe(400)
      expect((await retiredListRecords.json()).error).toBe('RepoNotFound')

      // Current handle resolves cleanly on all three endpoints.
      const currentDescribe = await callGet('com.atproto.repo.describeRepo', {
        query: `repo=${encodeURIComponent(currentHandle)}`
      })
      expect(currentDescribe.status).toBe(200)
      expect((await currentDescribe.json()).did).toBe(renamedDid)

      const currentGetRecord = await callGet('com.atproto.repo.getRecord', {
        query: new URLSearchParams({
          repo: currentHandle,
          collection: 'app.bsky.feed.post',
          rkey: '3kretired0001'
        }).toString()
      })
      expect(currentGetRecord.status).toBe(200)
      expect((await currentGetRecord.json()).cid).toBe(rec.cid)

      const currentListRecords = await callGet('com.atproto.repo.listRecords', {
        query: new URLSearchParams({
          repo: currentHandle,
          collection: 'app.bsky.feed.post'
        }).toString()
      })
      expect(currentListRecords.status).toBe(200)
      expect((await currentListRecords.json()).records).toHaveLength(1)
    })

    it('getRecord returns a record, validates cid match, and returns RecordNotFound when absent', async () => {
      const ok = await callGet('com.atproto.repo.getRecord', {
        query: new URLSearchParams({
          repo: DID_A,
          collection: 'app.bsky.feed.post',
          rkey: post1Rkey
        }).toString()
      })
      expect(ok.status).toBe(200)
      const data = await ok.json()
      expect(data.uri).toBe(post1Uri)
      expect(data.cid).toBe(post1Cid)
      expect(data.value.text).toBe('Hello from embedded PDS #1')

      const matchingCid = await callGet('com.atproto.repo.getRecord', {
        query: new URLSearchParams({
          repo: DID_A,
          collection: 'app.bsky.feed.post',
          rkey: post1Rkey,
          cid: post1Cid
        }).toString()
      })
      expect(matchingCid.status).toBe(200)

      const mismatchedCid = await callGet('com.atproto.repo.getRecord', {
        query: new URLSearchParams({
          repo: DID_A,
          collection: 'app.bsky.feed.post',
          rkey: post1Rkey,
          cid: post2Cid
        }).toString()
      })
      expect(mismatchedCid.status).toBe(400)
      expect((await mismatchedCid.json()).error).toBe('RecordNotFound')

      const missing = await callGet('com.atproto.repo.getRecord', {
        query: new URLSearchParams({
          repo: DID_A,
          collection: 'app.bsky.feed.post',
          rkey: 'nonexistent01'
        }).toString()
      })
      expect(missing.status).toBe(400)
      expect((await missing.json()).error).toBe('RecordNotFound')
    })

    it('listRecords supports limit, cursor, reverse, and validates query params', async () => {
      const page1 = await callGet('com.atproto.repo.listRecords', {
        query: new URLSearchParams({
          repo: DID_A,
          collection: 'app.bsky.feed.post',
          limit: '1'
        }).toString()
      })
      expect(page1.status).toBe(200)
      const body1 = await page1.json()
      expect(body1.records).toHaveLength(1)
      expect(body1.cursor).toBe('3kpost0000003')

      const page2 = await callGet('com.atproto.repo.listRecords', {
        query: new URLSearchParams({
          repo: DID_A,
          collection: 'app.bsky.feed.post',
          limit: '1',
          cursor: body1.cursor
        }).toString()
      })
      expect(page2.status).toBe(200)
      const body2 = await page2.json()
      expect(body2.records).toHaveLength(1)
      expect(body2.records[0].cid).toBe(post2Cid)
      expect(body2.cursor).toBe(post2Rkey)

      const reversed = await callGet('com.atproto.repo.listRecords', {
        query: new URLSearchParams({
          repo: DID_A,
          collection: 'app.bsky.feed.post',
          reverse: 'true'
        }).toString()
      })
      expect(reversed.status).toBe(200)
      const revBody = await reversed.json()
      expect(
        revBody.records.slice(0, 2).map((r: { cid: string }) => r.cid)
      ).toEqual([post1Cid, post2Cid])

      const invalidLimit = await callGet('com.atproto.repo.listRecords', {
        query: new URLSearchParams({
          repo: DID_A,
          collection: 'app.bsky.feed.post',
          limit: '101'
        }).toString()
      })
      expect(invalidLimit.status).toBe(400)
      expect((await invalidLimit.json()).error).toBe('InvalidRequest')

      const invalidReverse = await callGet('com.atproto.repo.listRecords', {
        query: new URLSearchParams({
          repo: DID_A,
          collection: 'app.bsky.feed.post',
          reverse: 'maybe'
        }).toString()
      })
      expect(invalidReverse.status).toBe(400)
      expect((await invalidReverse.json()).error).toBe('InvalidRequest')
    })
  })

  describe('com.atproto.sync.* endpoints', () => {
    it('getRepo streams a full CAR that verifies with @atproto/repo and supports since diffs', async () => {
      const fullRes = await callGet('com.atproto.sync.getRepo', {
        query: `did=${encodeURIComponent(DID_A)}`
      })
      expect(fullRes.status).toBe(200)
      expect(fullRes.headers.get('Content-Type')).toBe(
        'application/vnd.ipld.car'
      )
      expect(fullRes.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(fullRes.headers.get('Cache-Control')).toBe('no-store')
      expect(fullRes.headers.get('Vary')).toBe(XRPC_VARY_HEADER)
      expect(fullRes.headers.get(STRICT_TRANSPORT_SECURITY_HEADER.key)).toBe(
        STRICT_TRANSPORT_SECURITY_HEADER.value
      )

      const fullBytes = await readResponseBytes(fullRes)
      const verified = await verifyRepoCar(fullBytes, DID_A, keyA.did())
      expect(verified.commit.rev).toBe(latestCommitA.rev)
      expect(verified.creates).toHaveLength(3)

      // Incremental diff CAR since post1Rev
      const diffRes = await callGet('com.atproto.sync.getRepo', {
        query: new URLSearchParams({
          did: DID_A,
          since: post1Rev
        }).toString()
      })
      expect(diffRes.status).toBe(200)
      expect(diffRes.headers.get('Content-Type')).toBe(
        'application/vnd.ipld.car'
      )
      const diffBytes = await readResponseBytes(diffRes)
      const parsedDiff = await readCarWithRoot(diffBytes)
      expect(parsedDiff.root.toString()).toBe(latestCommitA.cid)
      expect(parsedDiff.blocks.has(parseCid(post2Cid))).toBe(true)

      // Verify incremental diff CAR against the repo state at post1Rev
      const verifiedDiff = await verifyDiffCar(
        repoAtPost1,
        diffBytes,
        DID_A,
        keyA.did()
      )
      expect(verifiedDiff.writes).toHaveLength(2)
    })

    it('sync.getRecord streams a record proof CAR verified with @atproto/repo', async () => {
      const proofRes = await callGet('com.atproto.sync.getRecord', {
        query: new URLSearchParams({
          did: DID_A,
          collection: 'app.bsky.feed.post',
          rkey: post1Rkey
        }).toString()
      })
      expect(proofRes.status).toBe(200)
      expect(proofRes.headers.get('Content-Type')).toBe(
        'application/vnd.ipld.car'
      )
      const proofBytes = await readResponseBytes(proofRes)
      const verified = await verifyProofs(
        proofBytes,
        [
          {
            collection: 'app.bsky.feed.post',
            rkey: post1Rkey,
            cid: parseCid(post1Cid)
          }
        ],
        DID_A,
        keyA.did()
      )
      expect(verified.verified).toHaveLength(1)
      expect(verified.unverified).toHaveLength(0)

      // Non-existent record proof (absence proof: cid: null)
      const absentRes = await callGet('com.atproto.sync.getRecord', {
        query: new URLSearchParams({
          did: DID_A,
          collection: 'app.bsky.feed.post',
          rkey: 'missing000001'
        }).toString()
      })
      expect(absentRes.status).toBe(200)
      const absentBytes = await readResponseBytes(absentRes)
      const verifiedAbsent = await verifyProofs(
        absentBytes,
        [
          {
            collection: 'app.bsky.feed.post',
            rkey: 'missing000001',
            cid: null
          }
        ],
        DID_A,
        keyA.did()
      )
      expect(verifiedAbsent.verified).toHaveLength(1)
      expect(verifiedAbsent.unverified).toHaveLength(0)
    })

    it('getBlocks returns requested blocks in a CAR and rejects >100, missing, or invalid CIDs', async () => {
      const res = await callGet('com.atproto.sync.getBlocks', {
        query: `did=${encodeURIComponent(DID_A)}&cids=${encodeURIComponent(post1Cid)}&cids=${encodeURIComponent(post2Cid)}`
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/vnd.ipld.car')

      const bytes = await readResponseBytes(res)
      const car = await readCar(bytes)
      expect(car.blocks.has(parseCid(post1Cid))).toBe(true)
      expect(car.blocks.has(parseCid(post2Cid))).toBe(true)

      // 101 CIDs must be rejected with 400 InvalidRequest
      const tooManyParams = new URLSearchParams({ did: DID_A })
      for (let i = 0; i < 101; i += 1) {
        tooManyParams.append('cids', post1Cid)
      }
      const tooManyRes = await callGet('com.atproto.sync.getBlocks', {
        query: tooManyParams.toString()
      })
      expect(tooManyRes.status).toBe(400)
      expect((await tooManyRes.json()).error).toBe('InvalidRequest')

      const missingBlock = await callGet('com.atproto.sync.getBlocks', {
        query: `did=${encodeURIComponent(DID_A)}&cids=${encodeURIComponent(postBCid)}`
      })
      expect(missingBlock.status).toBe(400)
      expect((await missingBlock.json()).error).toBe('InvalidRequest')

      const invalidCid = await callGet('com.atproto.sync.getBlocks', {
        query: `did=${encodeURIComponent(DID_A)}&cids=not-a-cid`
      })
      expect(invalidCid.status).toBe(400)
      expect((await invalidCid.json()).error).toBe('InvalidRequest')

      const emptyCids = await callGet('com.atproto.sync.getBlocks', {
        query: `did=${encodeURIComponent(DID_A)}`
      })
      expect(emptyCids.status).toBe(400)
      expect((await emptyCids.json()).error).toBe('InvalidRequest')
    })

    it('enforces per-client rate limits on sync and getBlob endpoints with 429 RateLimitExceeded and Retry-After', async () => {
      process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS = 'true'
      resetTrustProxyIpHeadersConfigCacheForTests()
      await database.deleteRateLimits({ keyPrefix: APP_RATE_LIMIT_KEY_PREFIX })

      try {
        // Exhaust the sync bucket for client 203.0.113.10
        for (let i = 0; i < PDS_SYNC_RATE_LIMIT; i += 1) {
          const ok = await callGet('com.atproto.sync.getLatestCommit', {
            query: `did=${encodeURIComponent(DID_A)}`,
            headers: { 'x-forwarded-for': '203.0.113.10' }
          })
          expect(ok.status).toBe(200)
        }

        const limitedSync = await callGet('com.atproto.sync.getRepo', {
          query: `did=${encodeURIComponent(DID_A)}`,
          headers: { 'x-forwarded-for': '203.0.113.10' }
        })
        expect(limitedSync.status).toBe(429)
        expect(limitedSync.headers.get('Cache-Control')).toBe('no-store')
        expect(limitedSync.headers.get('Vary')).toBe(XRPC_VARY_HEADER)
        expect(
          Number(limitedSync.headers.get('Retry-After'))
        ).toBeGreaterThanOrEqual(1)
        expect(await limitedSync.json()).toEqual({
          error: 'RateLimitExceeded',
          message: 'Rate limit exceeded'
        })

        // Another client IP is unaffected
        const otherClient = await callGet('com.atproto.sync.getLatestCommit', {
          query: `did=${encodeURIComponent(DID_A)}`,
          headers: { 'x-forwarded-for': '203.0.113.11' }
        })
        expect(otherClient.status).toBe(200)

        // Exhaust the getBlob bucket for client 203.0.113.20
        for (let i = 0; i < PDS_SYNC_BLOB_RATE_LIMIT; i += 1) {
          const okBlob = await callHead('com.atproto.sync.getBlob', {
            query: new URLSearchParams({
              did: DID_A,
              cid: pngBlobCid
            }).toString(),
            headers: { 'x-forwarded-for': '203.0.113.20' }
          })
          expect(okBlob.status).toBe(200)
        }

        const limitedBlob = await callGet('com.atproto.sync.getBlob', {
          query: new URLSearchParams({
            did: DID_A,
            cid: pngBlobCid
          }).toString(),
          headers: { 'x-forwarded-for': '203.0.113.20' }
        })
        expect(limitedBlob.status).toBe(429)
        expect(
          Number(limitedBlob.headers.get('Retry-After'))
        ).toBeGreaterThanOrEqual(1)
        expect((await limitedBlob.json()).error).toBe('RateLimitExceeded')

        // Exhaust the repo-read bucket for client 203.0.113.30 across describeRepo/getRecord/listRecords.
        for (let i = 0; i < PDS_REPO_READ_RATE_LIMIT; i += 1) {
          const okRepo = await callGet('com.atproto.repo.describeRepo', {
            query: `repo=${encodeURIComponent(DID_A)}`,
            headers: { 'x-forwarded-for': '203.0.113.30' }
          })
          expect(okRepo.status).toBe(200)
        }

        for (const check of [
          callGet('com.atproto.repo.describeRepo', {
            query: `repo=${encodeURIComponent(DID_A)}`,
            headers: { 'x-forwarded-for': '203.0.113.30' }
          }),
          callGet('com.atproto.repo.getRecord', {
            query: new URLSearchParams({
              repo: DID_A,
              collection: 'app.bsky.feed.post',
              rkey: post1Rkey
            }).toString(),
            headers: { 'x-forwarded-for': '203.0.113.30' }
          }),
          callGet('com.atproto.repo.listRecords', {
            query: new URLSearchParams({
              repo: DID_A,
              collection: 'app.bsky.feed.post'
            }).toString(),
            headers: { 'x-forwarded-for': '203.0.113.30' }
          })
        ]) {
          const limitedRepo = await check
          expect(limitedRepo.status).toBe(429)
          expect(
            Number(limitedRepo.headers.get('Retry-After'))
          ).toBeGreaterThanOrEqual(1)
          expect((await limitedRepo.json()).error).toBe('RateLimitExceeded')
        }

        // Another client IP and the sync bucket remain unaffected.
        const otherRepoClient = await callGet('com.atproto.repo.describeRepo', {
          query: `repo=${encodeURIComponent(DID_A)}`,
          headers: { 'x-forwarded-for': '203.0.113.31' }
        })
        expect(otherRepoClient.status).toBe(200)
        const syncSameClient = await callGet(
          'com.atproto.sync.getLatestCommit',
          {
            query: `did=${encodeURIComponent(DID_A)}`,
            headers: { 'x-forwarded-for': '203.0.113.30' }
          }
        )
        expect(syncSameClient.status).toBe(200)
      } finally {
        await database.deleteRateLimits({
          keyPrefix: APP_RATE_LIMIT_KEY_PREFIX
        })
      }
    })

    it('getLatestCommit returns the current commit CID and rev', async () => {
      const res = await callGet('com.atproto.sync.getLatestCommit', {
        query: `did=${encodeURIComponent(DID_A)}`
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(latestCommitA)
    })

    it('getRepoStatus reports active, deactivated, and takendown statuses', async () => {
      const activeRes = await callGet('com.atproto.sync.getRepoStatus', {
        query: `did=${encodeURIComponent(DID_A)}`
      })
      expect(activeRes.status).toBe(200)
      expect(await activeRes.json()).toEqual({
        did: DID_A,
        active: true,
        rev: latestCommitA.rev
      })

      const deactRes = await callGet('com.atproto.sync.getRepoStatus', {
        query: `did=${encodeURIComponent(DID_DEACTIVATED)}`
      })
      expect(deactRes.status).toBe(200)
      expect(await deactRes.json()).toEqual({
        did: DID_DEACTIVATED,
        active: false,
        status: 'deactivated'
      })

      const tdRes = await callGet('com.atproto.sync.getRepoStatus', {
        query: `did=${encodeURIComponent(DID_TAKENDOWN)}`
      })
      expect(tdRes.status).toBe(200)
      expect(await tdRes.json()).toEqual({
        did: DID_TAKENDOWN,
        active: false,
        status: 'takendown'
      })
    })

    it('listRepos lists only repos for the requested PDS domain and paginates with cursor/limit', async () => {
      const allRes = await callGet('com.atproto.sync.listRepos')
      expect(allRes.status).toBe(200)
      const allBody = await allRes.json()
      const listedDids = allBody.repos.map((r: { did: string }) => r.did)
      expect(listedDids).toContain(DID_A)
      expect(listedDids).toContain(DID_A2)
      expect(listedDids).toContain(DID_DEACTIVATED)
      expect(listedDids).toContain(DID_TAKENDOWN)
      expect(listedDids).not.toContain(DID_B)

      const page1 = await callGet('com.atproto.sync.listRepos', {
        query: 'limit=2'
      })
      expect(page1.status).toBe(200)
      const body1 = await page1.json()
      expect(body1.repos).toHaveLength(2)
      expect(body1.cursor).toBe(body1.repos[1].did)

      const page2 = await callGet('com.atproto.sync.listRepos', {
        query: `limit=2&cursor=${encodeURIComponent(body1.cursor)}`
      })
      expect(page2.status).toBe(200)
      const body2 = await page2.json()
      expect(body2.repos).toHaveLength(2)
    })

    it('listBlobs returns CIDs with since, cursor, and limit support', async () => {
      const allRes = await callGet('com.atproto.sync.listBlobs', {
        query: `did=${encodeURIComponent(DID_A)}`
      })
      expect(allRes.status).toBe(200)
      const allBody = await allRes.json()
      expect(allBody.cids).toHaveLength(3)
      expect(allBody.cids).toEqual(
        expect.arrayContaining([pngBlobCid, htmlBlobCid, svgBlobCid])
      )

      const sinceRes = await callGet('com.atproto.sync.listBlobs', {
        query: new URLSearchParams({
          did: DID_A,
          since: post1Rev
        }).toString()
      })
      expect(sinceRes.status).toBe(200)
      expect((await sinceRes.json()).cids).toEqual(
        expect.arrayContaining([htmlBlobCid, svgBlobCid])
      )

      const page1 = await callGet('com.atproto.sync.listBlobs', {
        query: new URLSearchParams({
          did: DID_A,
          limit: '1'
        }).toString()
      })
      expect(page1.status).toBe(200)
      const body1 = await page1.json()
      expect(body1.cids).toHaveLength(1)
      expect(body1.cursor).toBe(body1.cids[0])
    })

    it('getBlob returns exact bytes and safe Content-Type/Disposition/security headers for raster images, HTML, and SVG', async () => {
      // Raster image: inline canonical Content-Type (no Content-Disposition: attachment)
      const imgRes = await callGet('com.atproto.sync.getBlob', {
        query: new URLSearchParams({ did: DID_A, cid: pngBlobCid }).toString()
      })
      expect(imgRes.status).toBe(200)
      expect(imgRes.headers.get('Content-Type')).toBe('image/png')
      expect(imgRes.headers.get('Content-Length')).toBe(
        String(pngBlobBytes.byteLength)
      )
      expect(imgRes.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(imgRes.headers.get('Content-Security-Policy')).toBe(
        "default-src 'none'; sandbox"
      )
      expect(imgRes.headers.get('Cache-Control')).toBe('no-store')
      expect(imgRes.headers.get('Vary')).toBe(XRPC_VARY_HEADER)
      expect(imgRes.headers.get(STRICT_TRANSPORT_SECURITY_HEADER.key)).toBe(
        STRICT_TRANSPORT_SECURITY_HEADER.value
      )
      expect(imgRes.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(imgRes.headers.get('Content-Disposition')).toBeNull()
      expect(Buffer.from(await imgRes.arrayBuffer())).toEqual(pngBlobBytes)

      // Non-image (text/html): application/octet-stream + attachment + nosniff + sandbox CSP
      const htmlRes = await callGet('com.atproto.sync.getBlob', {
        query: new URLSearchParams({ did: DID_A, cid: htmlBlobCid }).toString()
      })
      expect(htmlRes.status).toBe(200)
      expect(htmlRes.headers.get('Content-Type')).toBe(
        'application/octet-stream'
      )
      expect(htmlRes.headers.get('Content-Length')).toBe(
        String(htmlBlobBytes.byteLength)
      )
      expect(htmlRes.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(htmlRes.headers.get('Content-Security-Policy')).toBe(
        "default-src 'none'; sandbox"
      )
      expect(htmlRes.headers.get('Content-Disposition')).toBe('attachment')
      expect(Buffer.from(await htmlRes.arrayBuffer())).toEqual(htmlBlobBytes)

      // SVG: application/octet-stream + attachment for XSS defense-in-depth
      const svgRes = await callGet('com.atproto.sync.getBlob', {
        query: new URLSearchParams({ did: DID_A, cid: svgBlobCid }).toString()
      })
      expect(svgRes.status).toBe(200)
      expect(svgRes.headers.get('Content-Type')).toBe(
        'application/octet-stream'
      )
      expect(svgRes.headers.get('Content-Disposition')).toBe('attachment')
      expect(Buffer.from(await svgRes.arrayBuffer())).toEqual(svgBlobBytes)

      // Missing blob -> 400 InvalidRequest
      const missingRes = await callGet('com.atproto.sync.getBlob', {
        query: new URLSearchParams({ did: DID_A, cid: blobBCid }).toString()
      })
      expect(missingRes.status).toBe(400)
      expect((await missingRes.json()).error).toBe('InvalidRequest')
    })

    it('handles HEAD on CAR endpoints and getBlob without leaking streams', async () => {
      const repoHead = await callHead('com.atproto.sync.getRepo', {
        query: `did=${encodeURIComponent(DID_A)}`
      })
      expect(repoHead.status).toBe(200)
      expect(repoHead.headers.get('Content-Type')).toBe(
        'application/vnd.ipld.car'
      )
      expect(repoHead.body).toBeNull()

      const getBlocksSpy = vi.spyOn(database, 'getPdsBlocks')
      try {
        const blocksHead = await callHead('com.atproto.sync.getBlocks', {
          query: `did=${encodeURIComponent(DID_A)}&cids=${encodeURIComponent(post1Cid)}`
        })
        expect(blocksHead.status).toBe(200)
        expect(blocksHead.headers.get('Content-Type')).toBe(
          'application/vnd.ipld.car'
        )
        expect(blocksHead.body).toBeNull()
        // HEAD validates CIDs via getPdsBlockSizes and must not read block bytes.
        expect(getBlocksSpy).not.toHaveBeenCalled()

        // HEAD still reports 400 when a requested CID is missing.
        const missingBlocksHead = await callHead('com.atproto.sync.getBlocks', {
          query: `did=${encodeURIComponent(DID_A)}&cids=${encodeURIComponent(postBCid)}`
        })
        expect(missingBlocksHead.status).toBe(400)
        expect(missingBlocksHead.body).toBeNull()
        expect(getBlocksSpy).not.toHaveBeenCalled()
      } finally {
        getBlocksSpy.mockRestore()
      }

      const recordHead = await callHead('com.atproto.sync.getRecord', {
        query: new URLSearchParams({
          did: DID_A,
          collection: 'app.bsky.feed.post',
          rkey: post1Rkey
        }).toString()
      })
      expect(recordHead.status).toBe(200)
      expect(recordHead.headers.get('Content-Type')).toBe(
        'application/vnd.ipld.car'
      )
      expect(recordHead.body).toBeNull()

      const blobHead = await callHead('com.atproto.sync.getBlob', {
        query: new URLSearchParams({ did: DID_A, cid: pngBlobCid }).toString()
      })
      expect(blobHead.status).toBe(200)
      expect(blobHead.headers.get('Content-Type')).toBe('image/png')
      expect(blobHead.headers.get('Content-Length')).toBe(
        String(pngBlobBytes.byteLength)
      )
      expect(blobHead.headers.get('Content-Security-Policy')).toBe(
        "default-src 'none'; sandbox"
      )
      expect(blobHead.body).toBeNull()
    })
  })

  describe('cross-domain isolation', () => {
    it('hides repos belonging to another enabled PDS domain with RepoNotFound', async () => {
      const checks = [
        callGet('com.atproto.repo.describeRepo', {
          query: `repo=${encodeURIComponent(DID_B)}`
        }),
        callGet('com.atproto.repo.describeRepo', {
          query: `repo=${encodeURIComponent(`otherpds.${DOMAIN_B}`)}`
        }),
        callGet('com.atproto.repo.getRecord', {
          query: new URLSearchParams({
            repo: DID_B,
            collection: 'app.bsky.feed.post',
            rkey: postBRkey
          }).toString()
        }),
        callGet('com.atproto.repo.listRecords', {
          query: new URLSearchParams({
            repo: DID_B,
            collection: 'app.bsky.feed.post'
          }).toString()
        }),
        callGet('com.atproto.sync.getRepo', {
          query: `did=${encodeURIComponent(DID_B)}`
        }),
        callGet('com.atproto.sync.getRecord', {
          query: new URLSearchParams({
            did: DID_B,
            collection: 'app.bsky.feed.post',
            rkey: postBRkey
          }).toString()
        }),
        callGet('com.atproto.sync.getBlocks', {
          query: `did=${encodeURIComponent(DID_B)}&cids=${encodeURIComponent(postBCid)}`
        }),
        callGet('com.atproto.sync.getLatestCommit', {
          query: `did=${encodeURIComponent(DID_B)}`
        }),
        callGet('com.atproto.sync.getRepoStatus', {
          query: `did=${encodeURIComponent(DID_B)}`
        }),
        callGet('com.atproto.sync.listBlobs', {
          query: `did=${encodeURIComponent(DID_B)}`
        }),
        callGet('com.atproto.sync.getBlob', {
          query: new URLSearchParams({ did: DID_B, cid: blobBCid }).toString()
        })
      ]

      const responses = await Promise.all(checks)
      for (const res of responses) {
        expect(res.status).toBe(400)
        expect((await res.json()).error).toBe('RepoNotFound')
      }

      // Meanwhile, DID_B IS visible on its own PDS hostname (PDS_HOST_B)
      const onOwnHost = await callGet('com.atproto.repo.describeRepo', {
        host: PDS_HOST_B,
        query: `repo=${encodeURIComponent(DID_B)}`
      })
      expect(onOwnHost.status).toBe(200)
      expect((await onOwnHost.json()).did).toBe(DID_B)
    })
  })

  describe('deactivated and takendown repos', () => {
    it.each([
      { did: DID_DEACTIVATED, expectedError: 'RepoDeactivated' },
      { did: DID_TAKENDOWN, expectedError: 'RepoTakendown' }
    ])(
      'returns $expectedError on sync and repo reads for $did',
      async ({ did, expectedError }) => {
        const checks = [
          callGet('com.atproto.repo.describeRepo', {
            query: `repo=${encodeURIComponent(did)}`
          }),
          callGet('com.atproto.repo.getRecord', {
            query: new URLSearchParams({
              repo: did,
              collection: 'app.bsky.feed.post',
              rkey: 'any000001'
            }).toString()
          }),
          callGet('com.atproto.repo.listRecords', {
            query: new URLSearchParams({
              repo: did,
              collection: 'app.bsky.feed.post'
            }).toString()
          }),
          callGet('com.atproto.sync.getRepo', {
            query: `did=${encodeURIComponent(did)}`
          }),
          callGet('com.atproto.sync.getRecord', {
            query: new URLSearchParams({
              did,
              collection: 'app.bsky.feed.post',
              rkey: 'any000001'
            }).toString()
          }),
          callGet('com.atproto.sync.getBlocks', {
            query: `did=${encodeURIComponent(did)}&cids=${encodeURIComponent(post1Cid)}`
          }),
          callGet('com.atproto.sync.getLatestCommit', {
            query: `did=${encodeURIComponent(did)}`
          }),
          callGet('com.atproto.sync.listBlobs', {
            query: `did=${encodeURIComponent(did)}`
          }),
          callGet('com.atproto.sync.getBlob', {
            query: new URLSearchParams({ did, cid: pngBlobCid }).toString()
          })
        ]

        const responses = await Promise.all(checks)
        for (const res of responses) {
          expect(res.status).toBe(400)
          expect((await res.json()).error).toBe(expectedError)
        }
      }
    )
  })

  describe('501 MethodNotImplemented and error safety', () => {
    it.each([
      'com.atproto.repo.createRecord',
      'com.atproto.repo.putRecord',
      'com.atproto.repo.deleteRecord',
      'com.atproto.repo.applyWrites',
      'com.atproto.repo.uploadBlob',
      'com.atproto.server.createSession',
      'com.atproto.server.refreshSession',
      'com.atproto.server.deleteSession',
      'com.atproto.server.getSession',
      'com.atproto.server.createAccount',
      'com.example.unknownMethod'
    ])(
      'answers 501 MethodNotImplemented for %s on enabled PDS host',
      async (nsid) => {
        const postRes = await callPost(nsid)
        expect(postRes.status).toBe(501)
        expect(postRes.headers.get('Access-Control-Allow-Origin')).toBe('*')
        expect(postRes.headers.get('Cache-Control')).toBe('no-store')
        expect(postRes.headers.get('Vary')).toBe(XRPC_VARY_HEADER)
        expect(postRes.headers.get(STRICT_TRANSPORT_SECURITY_HEADER.key)).toBe(
          STRICT_TRANSPORT_SECURITY_HEADER.value
        )
        expect(await postRes.json()).toEqual({
          error: 'MethodNotImplemented',
          message: 'Method Not Implemented'
        })

        const getRes = await callGet(nsid)
        expect(getRes.status).toBe(501)
        expect((await getRes.json()).error).toBe('MethodNotImplemented')
      }
    )

    it('answers 405 Method Not Allowed when POSTing to an implemented GET query', async () => {
      const res = await callPost('com.atproto.server.describeServer')
      expect(res.status).toBe(405)
      expect(res.headers.get('Allow')).toBe('GET, HEAD, OPTIONS')
      expect((await res.json()).error).toBe('InvalidRequest')
    })

    it('maps unexpected errors to 500 InternalServerError without leaking details', async () => {
      const brokenDb = {
        consumeRateLimit: vi
          .fn()
          .mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
        getPdsRepo: vi
          .fn()
          .mockRejectedValue(
            new Error('SECRET_SQL_DETAIL: connection string password123')
          )
      } as unknown as Database
      vi.mocked(getDatabase).mockReturnValue(brokenDb)

      const res = await callGet('com.atproto.sync.getLatestCommit', {
        query: `did=${encodeURIComponent(DID_A)}`
      })
      expect(res.status).toBe(500)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(res.headers.get('Vary')).toBe(XRPC_VARY_HEADER)
      const body = await res.json()
      expect(body).toEqual({
        error: 'InternalServerError',
        message: 'Internal Server Error'
      })
      expect(JSON.stringify(body)).not.toContain('SECRET_SQL_DETAIL')
      expect(JSON.stringify(body)).not.toContain('password123')
    })

    it('records the nsid span attribute only for a single valid NSID segment', async () => {
      const { provider, recordedSpans } = createRecordingTracerProvider()
      const tracerSpy = vi
        .spyOn(trace, 'getTracer')
        .mockImplementation(() => provider.getTracer('test'))

      try {
        await callGet('com.atproto.server.describeServer')
        expect(recordedSpans.at(-1)?.attributes.nsid).toBe(
          'com.atproto.server.describeServer'
        )

        await callHead('com.atproto.server.describeServer')
        expect(recordedSpans.at(-1)?.attributes.nsid).toBe(
          'com.atproto.server.describeServer'
        )

        await callPost('com.atproto.repo.createRecord')
        expect(recordedSpans.at(-1)?.attributes.nsid).toBe(
          'com.atproto.repo.createRecord'
        )

        for (const invalidPath of [
          undefined,
          [],
          ['com.atproto.server.describeServer', 'extra'],
          'not-a-valid-nsid',
          'secret_token_123'
        ] as Array<string | string[] | undefined>) {
          await callGet(invalidPath)
          expect('nsid' in (recordedSpans.at(-1)?.attributes ?? {})).toBe(false)
        }

        await callPost('not-a-valid-nsid')
        expect('nsid' in (recordedSpans.at(-1)?.attributes ?? {})).toBe(false)
      } finally {
        tracerSpy.mockRestore()
      }
    })
  })
})
