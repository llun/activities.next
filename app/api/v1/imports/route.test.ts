import { NextRequest } from 'next/server'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { BULK_IMPORT_JOB_NAME } from '@/lib/jobs/names'
import {
  BULK_IMPORT_FILE_SIZE_LIMIT,
  BULK_IMPORT_ROWS_LIMIT
} from '@/lib/services/imports/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { HTTP_STATUS } from '@/lib/utils/response'

import { GET, OPTIONS, POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: Database | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const mockPublish = vi.fn().mockResolvedValue(undefined)
let mockRunsInline = false
vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn(() => ({
    runsInline: mockRunsInline,
    publish: mockPublish
  }))
}))

describe('/api/v1/imports', () => {
  const { database, db, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockRunsInline = false
    mockPublish.mockResolvedValue(undefined)
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  afterEach(async () => {
    await db.deleteFrom('bulk_import_rows').execute()
    await db.deleteFrom('bulk_imports').execute()
  })

  const createPostRequest = (
    form?: FormData,
    options: {
      query?: string
      formDataError?: boolean
      origin?: string
    } = {}
  ) => {
    const origin = options.origin ?? 'https://llun.test'
    const url = `https://llun.test/api/v1/imports${options.query ?? ''}`
    if (options.formDataError) {
      return new NextRequest(url, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'multipart/form-data; boundary=missing'
        },
        body: 'not a multipart body'
      })
    }
    // The route reads the raw body, so send a real multipart one.
    return new NextRequest(url, {
      method: 'POST',
      headers: { origin },
      body: form
    })
  }

  const createGetRequest = (query = '') =>
    new NextRequest(`https://llun.test/api/v1/imports${query}`)

  describe('OPTIONS', () => {
    it('returns allowed methods', async () => {
      const req = new NextRequest('https://llun.test/api/v1/imports', {
        method: 'OPTIONS'
      })
      const response = await OPTIONS(req)
      expect(response.status).toBe(200)
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET,POST'
      )
    })
  })

  describe('POST', () => {
    const validCsv =
      'Account address,Show boosts,Notify on new posts,Languages\n' +
      'user1@remote.test,true,false,en\n' +
      'user2@remote.test,false,true,fr'

    const buildValidForm = (overrides: Record<string, unknown> = {}) => {
      const form = new FormData()
      form.set('type', 'following')
      form.set(
        'file',
        new File([validCsv], 'following_accounts.csv', { type: 'text/csv' })
      )

      for (const [key, val] of Object.entries(overrides)) {
        if (val === null || val === undefined) {
          form.delete(key)
        } else {
          form.set(key, val as string | File)
        }
      }
      return form
    }

    it('creates an import and publishes a job to the queue', async () => {
      const form = buildValidForm()
      const req = createPostRequest(form)

      const response = await POST(req, { params: Promise.resolve({}) })
      expect(response.status).toBe(HTTP_STATUS.ACCEPTED)

      const json = await response.json()
      expect(json).toMatchObject({
        id: expect.any(String),
        type: 'following',
        mode: 'merge',
        state: 'scheduled',
        originalFilename: 'following_accounts.csv',
        totalItems: 2,
        processedItems: 0,
        importedItems: 0,
        failedItems: 0,
        finishedAt: null
      })
      expect(typeof json.createdAt).toBe('string')
      expect('failedRows' in json).toBe(false)

      const rows = await database.getBulkImportRows({
        importId: json.id,
        fromRowIndex: 0,
        limit: 10
      })
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({
        importId: json.id,
        rowIndex: 0,
        data: {
          acct: 'user1@remote.test',
          show_reblogs: true,
          notify: false,
          languages: ['en']
        },
        state: 'pending',
        error: null
      })
      expect(rows[1]).toMatchObject({
        importId: json.id,
        rowIndex: 1,
        data: {
          acct: 'user2@remote.test',
          show_reblogs: false,
          notify: true,
          languages: ['fr']
        },
        state: 'pending',
        error: null
      })

      expect(mockPublish).toHaveBeenCalledTimes(1)
      expect(mockPublish).toHaveBeenCalledWith({
        id: `${json.id}:start`,
        name: BULK_IMPORT_JOB_NAME,
        data: { importId: json.id }
      })
    })

    it('stores overwrite mode correctly', async () => {
      const form = buildValidForm({ mode: 'overwrite' })
      const req = createPostRequest(form)

      const response = await POST(req, { params: Promise.resolve({}) })
      expect(response.status).toBe(HTTP_STATUS.ACCEPTED)

      const json = await response.json()
      expect(json.mode).toBe('overwrite')

      const stored = await database.getBulkImport({
        id: json.id,
        actorId: ACTOR1_ID
      })
      expect(stored?.overwrite).toBe(true)
    })

    it('returns 503, finishes the import and frees the actor when queue publish fails', async () => {
      mockPublish.mockRejectedValueOnce(new Error('Queue offline'))
      const response = await POST(createPostRequest(buildValidForm()), {
        params: Promise.resolve({})
      })
      expect(response.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE)
      expect(await response.json()).toEqual({
        error: 'Could not start the import, try again later'
      })

      const [stored] = await database.getBulkImports({
        actorId: ACTOR1_ID,
        limit: 1
      })
      expect(stored.state).toBe('finished')
      expect(stored.lastError).toBeTruthy()

      const retry = await POST(createPostRequest(buildValidForm()), {
        params: Promise.resolve({})
      })
      expect(retry.status).toBe(HTTP_STATUS.ACCEPTED)
    })

    it('starts an inline queue run without waiting for it and answers 202', async () => {
      mockRunsInline = true
      let finishRun!: () => void
      mockPublish.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishRun = resolve
        })
      )

      // Resolves although the "job" is still running.
      const response = await POST(createPostRequest(buildValidForm()), {
        params: Promise.resolve({})
      })
      expect(response.status).toBe(HTTP_STATUS.ACCEPTED)
      expect(mockPublish).toHaveBeenCalledTimes(1)
      finishRun()
    })

    it('answers 202 and finishes the import with an error when an inline run throws, freeing the actor', async () => {
      mockRunsInline = true
      mockPublish.mockRejectedValueOnce(new Error('job exploded'))

      const response = await POST(createPostRequest(buildValidForm()), {
        params: Promise.resolve({})
      })
      expect(response.status).toBe(HTTP_STATUS.ACCEPTED)
      await vi.waitFor(async () => {
        const [stored] = await database.getBulkImports({
          actorId: ACTOR1_ID,
          limit: 1
        })
        expect(stored.state).toBe('finished')
        expect(stored.lastError).toBeTruthy()
        expect(stored.finishedAt).not.toBeNull()
      })

      const retry = await POST(createPostRequest(buildValidForm()), {
        params: Promise.resolve({})
      })
      expect(retry.status).toBe(HTTP_STATUS.ACCEPTED)
    })

    it('returns 413 before reading the body when content-length is too large', async () => {
      const req = new NextRequest('https://llun.test/api/v1/imports', {
        method: 'POST',
        headers: {
          origin: 'https://llun.test',
          'content-length': `${BULK_IMPORT_FILE_SIZE_LIMIT + 64 * 1024 + 1}`
        }
      })
      const formData = vi.fn().mockRejectedValue(new Error('must not be read'))
      Object.defineProperty(req, 'formData', { value: formData })

      const response = await POST(req, { params: Promise.resolve({}) })
      expect(response.status).toBe(HTTP_STATUS.PAYLOAD_TOO_LARGE)
      expect(await response.json()).toEqual({ error: 'File is too large' })
      expect(formData).not.toHaveBeenCalled()
    })

    it('returns 413 for a chunked body over the cap that has no content-length', async () => {
      const chunk = new Uint8Array(1024 * 1024)
      let sent = 0
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          sent += chunk.byteLength
          controller.enqueue(chunk)
          // Would run on for ever if the route did not stop reading.
          if (sent > BULK_IMPORT_FILE_SIZE_LIMIT * 4) controller.close()
        }
      })
      const req = new NextRequest('https://llun.test/api/v1/imports', {
        method: 'POST',
        headers: {
          origin: 'https://llun.test',
          'content-type': 'multipart/form-data; boundary=x'
        },
        body,
        duplex: 'half'
      } as ConstructorParameters<typeof NextRequest>[1])
      expect(req.headers.get('content-length')).toBeNull()

      const response = await POST(req, { params: Promise.resolve({}) })
      expect(response.status).toBe(HTTP_STATUS.PAYLOAD_TOO_LARGE)
      expect(await response.json()).toEqual({ error: 'File is too large' })
      // Stopped near the cap, not after the whole stream.
      expect(sent).toBeLessThan(BULK_IMPORT_FILE_SIZE_LIMIT * 2)
    })

    it('returns 400 when formData fails to parse', async () => {
      const req = createPostRequest(undefined, { formDataError: true })
      const response = await POST(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST)
      expect(await response.json()).toEqual({ error: 'Invalid request' })
    })

    it('returns 422 when file is missing', async () => {
      const form = buildValidForm({ file: null })
      const req = createPostRequest(form)

      const response = await POST(req, { params: Promise.resolve({}) })
      expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await response.json()).toEqual({ error: 'File is required' })
    })

    it('returns 422 when file is not an instance of File', async () => {
      const form = new FormData()
      form.set('type', 'following')
      form.set('file', 'plain-string-not-file')
      const req = createPostRequest(form)

      const response = await POST(req, { params: Promise.resolve({}) })
      expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await response.json()).toEqual({ error: 'File is required' })
    })

    it('returns 422 when type is missing or invalid', async () => {
      const formMissing = buildValidForm({ type: null })
      const responseMissing = await POST(createPostRequest(formMissing), {
        params: Promise.resolve({})
      })
      expect(responseMissing.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await responseMissing.json()).toEqual({
        error: 'Invalid import type'
      })

      const formInvalid = buildValidForm({ type: 'not-a-valid-type' })
      const responseInvalid = await POST(createPostRequest(formInvalid), {
        params: Promise.resolve({})
      })
      expect(responseInvalid.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await responseInvalid.json()).toEqual({
        error: 'Invalid import type'
      })
    })

    it('returns 422 when mode is invalid', async () => {
      const form = buildValidForm({ mode: 'replace' })
      const req = createPostRequest(form)

      const response = await POST(req, { params: Promise.resolve({}) })
      expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await response.json()).toEqual({ error: 'Invalid import mode' })
    })

    it('returns 413 when the file exceeds the limit but fits the multipart allowance', async () => {
      const file = new File(
        [new Uint8Array(BULK_IMPORT_FILE_SIZE_LIMIT + 1)],
        'following_accounts.csv',
        { type: 'text/csv' }
      )

      const form = new FormData()
      form.set('type', 'following')
      form.set('file', file)
      const req = createPostRequest(form)

      const response = await POST(req, { params: Promise.resolve({}) })
      expect(response.status).toBe(HTTP_STATUS.PAYLOAD_TOO_LARGE)
      expect(await response.json()).toEqual({ error: 'File is too large' })
    })

    it('returns 422 when CSV is empty', async () => {
      const emptyFile = new File(['   '], 'empty.csv', { type: 'text/csv' })
      const form = new FormData()
      form.set('type', 'following')
      form.set('file', emptyFile)
      const req = createPostRequest(form)

      const response = await POST(req, { params: Promise.resolve({}) })
      expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await response.json()).toEqual({ error: 'This file is empty' })
    })

    it('returns 422 when CSV headers do not match the selected type', async () => {
      const wrongHeaders = '#domain\nremote.test'
      const file = new File([wrongHeaders], 'following.csv', {
        type: 'text/csv'
      })
      const form = new FormData()
      form.set('type', 'following')
      form.set('file', file)
      const req = createPostRequest(form)

      const response = await POST(req, { params: Promise.resolve({}) })
      expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await response.json()).toEqual({
        error: 'This file does not match the selected import type'
      })
    })

    it('returns 422 when CSV has more than 20,000 rows', async () => {
      const rows = ['Account address']
      for (let i = 0; i <= BULK_IMPORT_ROWS_LIMIT; i++) {
        rows.push(`user${i}@remote.test`)
      }
      const largeFile = new File([rows.join('\n')], 'huge.csv', {
        type: 'text/csv'
      })
      const form = new FormData()
      form.set('type', 'following')
      form.set('file', largeFile)
      const req = createPostRequest(form)

      const response = await POST(req, { params: Promise.resolve({}) })
      expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await response.json()).toEqual({
        error: `You can import up to ${BULK_IMPORT_ROWS_LIMIT} rows at a time`
      })
    })

    it('returns 409 when an import is already in progress', async () => {
      const form1 = buildValidForm()
      const res1 = await POST(createPostRequest(form1), {
        params: Promise.resolve({})
      })
      expect(res1.status).toBe(HTTP_STATUS.ACCEPTED)

      const form2 = buildValidForm()
      const res2 = await POST(createPostRequest(form2), {
        params: Promise.resolve({})
      })
      expect(res2.status).toBe(HTTP_STATUS.CONFLICT)
      expect(await res2.json()).toEqual({
        error: 'An import is already in progress'
      })
    })

    it('returns 409 when actorId does not match authenticated actor in form or query', async () => {
      const formWithForeignActor = buildValidForm({ actorId: ACTOR2_ID })
      const resForm = await POST(createPostRequest(formWithForeignActor), {
        params: Promise.resolve({})
      })
      expect(resForm.status).toBe(HTTP_STATUS.CONFLICT)
      expect(await resForm.json()).toEqual({ error: 'Actor changed' })

      const formValid = buildValidForm()
      const resQuery = await POST(
        createPostRequest(formValid, {
          query: `?actorId=${encodeURIComponent(ACTOR2_ID)}`
        }),
        { params: Promise.resolve({}) }
      )
      expect(resQuery.status).toBe(HTTP_STATUS.CONFLICT)
      expect(await resQuery.json()).toEqual({ error: 'Actor changed' })
    })

    it('rejects unauthenticated request', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const form = buildValidForm()
      const req = createPostRequest(form)

      const response = await POST(req, { params: Promise.resolve({}) })
      expect(response.status).toBe(307)
      expect(response.headers.get('Location')).toContain('/auth/signin')
    })
  })

  describe('GET', () => {
    it('returns only the current actor imports, ordered newest first and capped at 20', async () => {
      const now = Date.now()
      for (let i = 0; i < 25; i++) {
        await db
          .insertInto('bulk_imports')
          .values({
            id: `actor1-import-${i}`,
            actorId: ACTOR1_ID,
            type: 'following',
            overwrite: false,
            state: 'finished',
            originalFilename: `file-${i}.csv`,
            totalItems: 5,
            processedItems: 5,
            importedItems: 5,
            overwriteDone: false,
            nextRowIndex: 5,
            lastError: null,
            finishedAt: new Date(now - (30 - i) * 1000),
            createdAt: new Date(now - (30 - i) * 1000),
            updatedAt: new Date(now - (30 - i) * 1000)
          })
          .execute()
      }

      await db
        .insertInto('bulk_imports')
        .values({
          id: 'actor2-import-1',
          actorId: ACTOR2_ID,
          type: 'following',
          overwrite: false,
          state: 'scheduled',
          originalFilename: 'actor2.csv',
          totalItems: 1,
          processedItems: 0,
          importedItems: 0,
          overwriteDone: false,
          nextRowIndex: 0,
          lastError: null,
          finishedAt: null,
          createdAt: new Date(now),
          updatedAt: new Date(now)
        })
        .execute()

      const req = createGetRequest()
      const response = await GET(req, { params: Promise.resolve({}) })
      expect(response.status).toBe(HTTP_STATUS.OK)

      const list = await response.json()
      expect(Array.isArray(list)).toBe(true)
      expect(list).toHaveLength(20)

      expect(list[0].id).toBe('actor1-import-24')
      expect(list[1].id).toBe('actor1-import-23')
      expect(
        list.some((item: { id: string }) => item.id === 'actor2-import-1')
      ).toBe(false)
    })

    it('returns 409 when actorId query param does not match current actor', async () => {
      const req = createGetRequest(`?actorId=${encodeURIComponent(ACTOR2_ID)}`)
      const response = await GET(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(HTTP_STATUS.CONFLICT)
      expect(await response.json()).toEqual({ error: 'Actor changed' })
    })

    it('rejects unauthenticated request', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const req = createGetRequest()

      const response = await GET(req, { params: Promise.resolve({}) })
      expect(response.status).toBe(307)
      expect(response.headers.get('Location')).toContain('/auth/signin')
    })
  })
})
