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
vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn(() => ({
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
    const req = new NextRequest(url, {
      method: 'POST',
      headers: {
        origin
      }
    })

    if (options.formDataError) {
      Object.defineProperty(req, 'formData', {
        value: vi.fn().mockRejectedValue(new Error('Invalid multipart body'))
      })
    } else if (form) {
      Object.defineProperty(req, 'formData', {
        value: vi.fn().mockResolvedValue(form)
      })
    }

    return req
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

    it('returns 422 and does not call file.text() when file size exceeds limit', async () => {
      const file = new File(['content'], 'following_accounts.csv', {
        type: 'text/csv'
      })
      Object.defineProperty(file, 'size', {
        value: BULK_IMPORT_FILE_SIZE_LIMIT + 1
      })
      const textSpy = vi.spyOn(file, 'text')

      const form = new FormData()
      form.set('type', 'following')
      form.set('file', file)
      const req = createPostRequest(form)

      const response = await POST(req, { params: Promise.resolve({}) })
      expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await response.json()).toEqual({ error: 'File is too large' })
      expect(textSpy).not.toHaveBeenCalled()
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
