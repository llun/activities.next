import { NextRequest } from 'next/server'

import type { Database } from '@/lib/database/types'
import {
  EXPORT_FILES,
  ExportFileName
} from '@/lib/services/exports/accountExports'
import { MockActor } from '@/lib/stub/actor'
import { Actor } from '@/lib/types/domain/actor'
import { HTTP_STATUS } from '@/lib/utils/response'

import { GET } from './route'

const mockDatabase = {} as Database

const defaultActor: Actor = MockActor({
  id: 'https://llun.test/users/llun'
})

let mockCurrentActor: Actor | null = defaultActor

const mockExportAccountData = vi.fn(
  async (file: ExportFileName, _db: Database, _actorId: string) => {
    return `header1,header2\n${file}-row1,${file}-row2\n`
  }
)

vi.mock('@/lib/services/exports/accountExports', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/services/exports/accountExports')
    >()
  return {
    ...actual,
    exportAccountData: (file: ExportFileName, db: Database, actorId: string) =>
      mockExportAccountData(file, db, actorId)
  }
})

vi.mock('@/lib/services/guards/AuthenticatedGuard', () => ({
  AuthenticatedGuard:
    (
      handle: (
        req: NextRequest,
        context: {
          database: Database
          currentActor: Actor
          params: Promise<{ file: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{ file: string }> }) => {
      if (!mockCurrentActor) {
        return Response.redirect(new URL('/auth/signin', req.url), 307)
      }
      return handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      })
    }
}))

const createGetRequest = (file: string, actorId?: string) => {
  const url = new URL(`https://llun.test/api/v1/exports/${file}`)
  if (actorId !== undefined) {
    url.searchParams.set('actorId', actorId)
  }
  return new NextRequest(url, {
    method: 'GET',
    headers: {
      origin: 'https://llun.test'
    }
  })
}

describe('GET /api/v1/exports/[file]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCurrentActor = defaultActor
  })

  describe('Success 200', () => {
    it.each(EXPORT_FILES)(
      'returns 200 with csv content and correct headers for %s',
      async (fileName) => {
        const req = createGetRequest(fileName)
        const res = await GET(req, {
          params: Promise.resolve({ file: fileName })
        })

        expect(res.status).toBe(HTTP_STATUS.OK)
        expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
        expect(res.headers.get('Content-Disposition')).toBe(
          `attachment; filename="${fileName}"`
        )
        expect(res.headers.get('Cache-Control')).toBe('no-store')

        const body = await res.text()
        expect(body).toBe(
          `header1,header2\n${fileName}-row1,${fileName}-row2\n`
        )
        expect(mockExportAccountData).toHaveBeenCalledWith(
          fileName,
          mockDatabase,
          mockCurrentActor?.id
        )
      }
    )
  })

  describe('Unknown file 404', () => {
    it('returns 404 with error body for unknown file', async () => {
      const req = createGetRequest('unknown_accounts.csv')
      const res = await GET(req, {
        params: Promise.resolve({ file: 'unknown_accounts.csv' })
      })

      expect(res.status).toBe(HTTP_STATUS.NOT_FOUND)
      expect(await res.json()).toEqual({ error: 'Record not found' })
      expect(mockExportAccountData).not.toHaveBeenCalled()
    })

    it('returns 404 when file parameter is empty string', async () => {
      const req = createGetRequest('')
      const res = await GET(req, {
        params: Promise.resolve({ file: '' })
      })

      expect(res.status).toBe(HTTP_STATUS.NOT_FOUND)
      expect(await res.json()).toEqual({ error: 'Record not found' })
      expect(mockExportAccountData).not.toHaveBeenCalled()
    })
  })

  describe('actorId conflict 409', () => {
    it('returns 409 conflict when actorId query param mismatches current actor', async () => {
      const req = createGetRequest(
        'following_accounts.csv',
        'https://llun.test/users/other'
      )
      const res = await GET(req, {
        params: Promise.resolve({ file: 'following_accounts.csv' })
      })

      expect(res.status).toBe(HTTP_STATUS.CONFLICT)
      expect(await res.json()).toEqual({ error: 'Actor changed' })
      expect(mockExportAccountData).not.toHaveBeenCalled()
    })
  })

  describe('actorId matching succeeds', () => {
    it('returns 200 when actorId query param matches current actor', async () => {
      const req = createGetRequest(
        'following_accounts.csv',
        'https://llun.test/users/llun'
      )
      const res = await GET(req, {
        params: Promise.resolve({ file: 'following_accounts.csv' })
      })

      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(await res.text()).toBe(
        'header1,header2\nfollowing_accounts.csv-row1,following_accounts.csv-row2\n'
      )
      expect(mockExportAccountData).toHaveBeenCalledWith(
        'following_accounts.csv',
        mockDatabase,
        'https://llun.test/users/llun'
      )
    })
  })

  describe('Unauthenticated rejected', () => {
    it('rejects unauthenticated requests by redirecting to signin', async () => {
      mockCurrentActor = null
      const req = createGetRequest('following_accounts.csv')
      const res = await GET(req, {
        params: Promise.resolve({ file: 'following_accounts.csv' })
      })

      expect(res.status).toBe(307)
      expect(res.headers.get('Location')).toContain('/auth/signin')
      expect(mockExportAccountData).not.toHaveBeenCalled()
    })
  })
})
