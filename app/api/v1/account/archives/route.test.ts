import type { S3Client } from '@aws-sdk/client-s3'
import fs from 'fs/promises'
import { NextRequest } from 'next/server'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'

import { MediaStorageType } from '@/lib/config/mediaStorage'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'

import { GET as download } from './[id]/download/route'
import { GET, POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', async () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockGetConfig = vi.fn()
vi.mock('@/lib/config', async () => ({
  getConfig: () => mockGetConfig(),
  getBaseURL: () => 'https://llun.test',
  buildBaseURL: (host: string) => `https://${host}`
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', async () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/services/queue', () => ({ getQueue: vi.fn() }))

describe('account archive routes', () => {
  const { database, db, prepare, destroy } = createTestDatabase({
    backend: 'sqlite'
  })
  const publish = vi.fn()
  let root: string

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await db.deleteFrom('account_archives').execute()
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-routes-'))
    mockGetServerSession.mockReset().mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockGetConfig.mockReset().mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      mediaStorage: { type: MediaStorageType.LocalFile, path: root }
    })
    publish.mockReset().mockResolvedValue(undefined)
    vi.mocked(getQueue).mockReturnValue({
      runsInline: false,
      publish,
      handle: vi.fn()
    } as unknown as ReturnType<typeof getQueue>)
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  const post = (body?: unknown) =>
    POST(
      new NextRequest('https://llun.test/api/v1/account/archives', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      }),
      { params: Promise.resolve({}) }
    )

  const list = () =>
    GET(new NextRequest('https://llun.test/api/v1/account/archives'), {
      params: Promise.resolve({})
    })

  const fetchDownload = (id: string, range?: string) =>
    download(
      new NextRequest(
        `https://llun.test/api/v1/account/archives/${id}/download`,
        range ? { headers: { range } } : undefined
      ),
      { params: Promise.resolve({ id }) }
    )

  const getAccountId = async (email: string) =>
    (await database.getActorFromEmail({ email }))!.account!.id

  it('starts an export and lists it', async () => {
    const response = await post({ stripExactLocations: true })
    expect(response.status).toBe(202)
    const created = await response.json()
    expect(created).toMatchObject({
      status: 'queued',
      stripExactLocations: true,
      includesDrafts: false,
      downloadUrl: null
    })
    expect(publish).toHaveBeenCalledTimes(1)

    const listed = await (await list()).json()
    expect(listed).toHaveLength(1)
    expect(listed[0].id).toBe(created.id)
    // Nothing internal leaks into the response.
    expect(Object.keys(listed[0]).sort()).toEqual(
      [
        'bytes',
        'createdAt',
        'downloadUrl',
        'error',
        'expiresAt',
        'id',
        'includesDrafts',
        'readyAt',
        'status',
        'stripExactLocations'
      ].sort()
    )
  })

  it('accepts an empty body', async () => {
    expect((await post()).status).toBe(202)
  })

  it('answers 429 with the retry time while an export is running', async () => {
    const created = await (await post()).json()
    const row = (await database.getAccountArchive({ id: created.id }))!
    const response = await post()
    expect(response.status).toBe(429)
    const nextAllowedAt = new Date(
      row.createdAt + 7 * 24 * 60 * 60 * 1000
    ).toISOString()
    expect((await response.json()).nextAllowedAt).toBe(nextAllowedAt)
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('answers 429 with the next allowed date inside 7 days', async () => {
    const created = await (await post()).json()
    await database.updateAccountArchive({ id: created.id, status: 'ready' })
    const row = (await database.getAccountArchive({ id: created.id }))!
    const response = await post()
    expect(response.status).toBe(429)
    const data = await response.json()
    expect(data.nextAllowedAt).toBe(
      new Date(row.createdAt + 7 * 24 * 60 * 60 * 1000).toISOString()
    )
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('validates drafts: 422 for a bad payload, 413 for a large one', async () => {
    expect((await post({ drafts: { nope: true } })).status).toBe(422)
    expect(
      (
        await post({
          drafts: [
            { id: 'x', composer: 'post-box', text: 'x'.repeat(5 * 1024 * 1024) }
          ]
        })
      ).status
    ).toBe(413)
    expect((await post({ stripExactLocations: 'yes' })).status).toBe(400)
  })

  it('stops reading a body past the limit even when it declares no length', async () => {
    let pulled = 0
    const chunk = new Uint8Array(1024 * 1024).fill(0x20)
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        if (pulled > 64) return controller.close()
        controller.enqueue(chunk)
      }
    })
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/account/archives', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body,
        duplex: 'half'
      } as unknown as ConstructorParameters<typeof NextRequest>[1]),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(413)
    // It stopped near the 6 MiB cap instead of draining all 64 MiB.
    expect(pulled).toBeLessThan(20)
  })

  it('refuses a cross-site request', async () => {
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/account/archives', {
        method: 'POST',
        headers: { origin: 'https://evil.test' }
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(403)
  })

  describe('download', () => {
    const makeReady = async (email: string) => {
      const accountId = await getAccountId(email)
      const id = crypto.randomUUID()
      await database.createAccountArchive({
        id,
        accountId,
        options: { stripExactLocations: false, drafts: false }
      })
      const target = path.join(root, 'archives', id, 'archive.zip')
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, 'ZIPDATA')
      await database.updateAccountArchive({
        id,
        status: 'ready',
        storagePath: `archives/${id}/archive.zip`,
        bytes: 7,
        readyAt: Date.now(),
        expiresAt: Date.now() + 60_000
      })
      return id
    }

    it('streams the file to its owner as an attachment', async () => {
      const id = await makeReady(seedActor1.email)
      const response = await fetchDownload(id)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/zip')
      expect(response.headers.get('content-disposition')).toMatch(
        /^attachment; filename="activities-archive-[0-9a-f]{8}\.zip"$/
      )
      expect(response.headers.get('cache-control')).toContain('no-store')
      expect(await response.text()).toBe('ZIPDATA')
    })

    it('resumes a download from a byte offset', async () => {
      const id = await makeReady(seedActor1.email)
      const response = await fetchDownload(id, 'bytes=3-')
      expect(response.status).toBe(206)
      expect(response.headers.get('content-range')).toBe('bytes 3-6/7')
      expect(response.headers.get('content-length')).toBe('4')
      expect(response.headers.get('accept-ranges')).toBe('bytes')
      expect(await response.text()).toBe('DATA')
    })

    it('answers 416 to an offset past the end and ignores other range forms', async () => {
      const id = await makeReady(seedActor1.email)
      const past = await fetchDownload(id, 'bytes=7-')
      expect(past.status).toBe(416)
      expect(past.headers.get('content-range')).toBe('bytes */7')
      for (const range of ['bytes=-3', 'bytes=1-2', 'bytes=0-1,3-4']) {
        const whole = await fetchDownload(id, range)
        expect(whole.status).toBe(200)
        expect(await whole.text()).toBe('ZIPDATA')
      }
    })

    it('answers 404 to another account, as for an id that does not exist', async () => {
      const id = await makeReady(seedActor2.email)
      const other = await fetchDownload(id)
      expect(other.status).toBe(404)
      const missing = await fetchDownload(crypto.randomUUID())
      expect(missing.status).toBe(404)
      expect(await other.json()).toEqual(await missing.json())
    })

    it('answers 404 while the archive is not ready', async () => {
      const created = await (await post()).json()
      expect((await fetchDownload(created.id)).status).toBe(404)
    })

    it('answers 410 and deletes the file once it has expired', async () => {
      const id = await makeReady(seedActor1.email)
      await database.updateAccountArchive({ id, expiresAt: Date.now() - 1 })
      const response = await fetchDownload(id)
      expect(response.status).toBe(410)
      await expect(
        fs.stat(path.join(root, 'archives', id, 'archive.zip'))
      ).rejects.toThrow()
      expect((await (await list()).json())[0].status).toBe('expired')
    })

    it('redirects to a signed URL when the storage can serve one', async () => {
      const id = await makeReady(seedActor1.email)
      const objectStore =
        await import('@/lib/services/accountArchive/objectStore')
      const spy = vi
        .spyOn(objectStore, 'getArchiveObjectStore')
        .mockReturnValue({
          size: async () => 7,
          getDownloadUrl: async () => 'https://bucket.test/signed?x=1'
        } as unknown as ReturnType<typeof objectStore.getArchiveObjectStore>)
      const response = await fetchDownload(id)
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe(
        'https://bucket.test/signed?x=1'
      )
      spy.mockRestore()
    })

    it('answers 404, not a redirect to an error page, when the object is gone', async () => {
      const id = await makeReady(seedActor1.email)
      const objectStore =
        await import('@/lib/services/accountArchive/objectStore')
      const spy = vi
        .spyOn(objectStore, 'getArchiveObjectStore')
        .mockReturnValue({
          size: async () => null,
          getDownloadUrl: async () => 'https://bucket.test/signed?x=1'
        } as unknown as ReturnType<typeof objectStore.getArchiveObjectStore>)
      const response = await fetchDownload(id)
      expect(response.status).toBe(404)
      expect(response.headers.get('location')).toBeNull()
      spy.mockRestore()
    })

    it('streams through the server, with no redirect, when the bucket has a public hostname', async () => {
      const id = await makeReady(seedActor1.email)
      const objectStore =
        await import('@/lib/services/accountArchive/objectStore')
      const send = vi.fn(async (command: unknown) => {
        const name = (command as { constructor: { name: string } }).constructor
          .name
        if (name === 'HeadObjectCommand') return { ContentLength: 7 }
        return { Body: Readable.from([Buffer.from('ZIPDATA')]) }
      })
      const store = new objectStore.S3ArchiveObjectStore(
        {
          type: MediaStorageType.S3Storage,
          bucket: 'bucket',
          region: 'us-east-1',
          hostname: 'media.example.com'
        },
        { send } as unknown as S3Client
      )
      const spy = vi
        .spyOn(objectStore, 'getArchiveObjectStore')
        .mockReturnValue(store)
      const response = await fetchDownload(id)
      expect(response.status).toBe(200)
      expect(response.headers.get('location')).toBeNull()
      expect(response.headers.get('content-length')).toBe('7')
      expect(await response.text()).toBe('ZIPDATA')
      spy.mockRestore()
    })

    it('redirects an anonymous caller to sign in', async () => {
      const id = await makeReady(seedActor1.email)
      mockGetServerSession.mockResolvedValue(null)
      const response = await fetchDownload(id)
      expect([302, 303, 307]).toContain(response.status)
      expect(response.headers.get('location')).toContain('/auth/signin')
    })
  })
})
