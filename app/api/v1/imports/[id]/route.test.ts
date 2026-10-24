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

import { getBulkImportRowId } from '@/lib/database/domains/bulkImport/queries'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { HTTP_STATUS } from '@/lib/utils/response'

import { GET, OPTIONS } from './route'

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

describe('/api/v1/imports/[id]', () => {
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
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  afterEach(async () => {
    await db.deleteFrom('bulk_import_rows').execute()
    await db.deleteFrom('bulk_imports').execute()
  })

  const createGetRequest = (id: string, query = '') =>
    new NextRequest(`https://llun.test/api/v1/imports/${id}${query}`)

  describe('OPTIONS', () => {
    it('returns allowed methods', async () => {
      const req = new NextRequest('https://llun.test/api/v1/imports/test-id', {
        method: 'OPTIONS'
      })
      const response = await OPTIONS(req)
      expect(response.status).toBe(200)
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET')
    })
  })

  describe('GET', () => {
    it('returns own import with failed rows', async () => {
      const importId = 'test-import-1'
      const created = await database.createBulkImport({
        id: importId,
        actorId: ACTOR1_ID,
        type: 'following',
        overwrite: false,
        originalFilename: 'following.csv',
        rows: [
          { acct: 'valid@remote.test' },
          { acct: 'missing@remote.test' },
          { acct: 'another@remote.test' }
        ]
      })
      expect(created).not.toBeNull()

      // Mark row 0 imported, row 1 failed
      await database.markBulkImportRowProcessed({
        importId,
        rowId: getBulkImportRowId(importId, 0),
        imported: true
      })
      await database.markBulkImportRowProcessed({
        importId,
        rowId: getBulkImportRowId(importId, 1),
        imported: false,
        error: 'Remote account not found'
      })

      const req = createGetRequest(importId)
      const response = await GET(req, {
        params: Promise.resolve({ id: importId })
      })

      expect(response.status).toBe(HTTP_STATUS.OK)
      const json = await response.json()
      expect(json).toMatchObject({
        id: importId,
        type: 'following',
        mode: 'merge',
        state: 'scheduled',
        originalFilename: 'following.csv',
        totalItems: 3,
        processedItems: 2,
        importedItems: 1,
        failedItems: 1,
        finishedAt: null
      })

      expect(json.failedRows).toHaveLength(1)
      expect(json.failedRows[0]).toEqual({
        rowIndex: 1,
        data: { acct: 'missing@remote.test' },
        error: 'Remote account not found'
      })
    })

    it('returns 404 for an import owned by another actor', async () => {
      const importId = 'actor2-import'
      await database.createBulkImport({
        id: importId,
        actorId: ACTOR2_ID,
        type: 'following',
        overwrite: false,
        originalFilename: 'actor2.csv',
        rows: [{ acct: 'user@remote.test' }]
      })

      const req = createGetRequest(importId)
      const response = await GET(req, {
        params: Promise.resolve({ id: importId })
      })

      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND)
      expect(await response.json()).toEqual({ error: 'Record not found' })
    })

    it('returns 404 for a non-existent import', async () => {
      const req = createGetRequest('non-existent-id')
      const response = await GET(req, {
        params: Promise.resolve({ id: 'non-existent-id' })
      })

      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND)
      expect(await response.json()).toEqual({ error: 'Record not found' })
    })

    it('returns 409 when actorId query param does not match current actor', async () => {
      const req = createGetRequest(
        'some-import-id',
        `?actorId=${encodeURIComponent(ACTOR2_ID)}`
      )
      const response = await GET(req, {
        params: Promise.resolve({ id: 'some-import-id' })
      })

      expect(response.status).toBe(HTTP_STATUS.CONFLICT)
      expect(await response.json()).toEqual({ error: 'Actor changed' })
    })

    it('rejects unauthenticated request', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const req = createGetRequest('some-import-id')
      const response = await GET(req, {
        params: Promise.resolve({ id: 'some-import-id' })
      })

      expect(response.status).toBe(307)
      expect(response.headers.get('Location')).toContain('/auth/signin')
    })
  })
})
