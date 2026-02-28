import { getPresignedFitnessFileUrl } from '@/lib/services/fitness-files'

import { POST } from './route'

const mockGetServerSession = jest.fn()
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args)
}))

jest.mock('@/app/api/auth/[...nextauth]/authOptions', () => ({
  getAuthOptions: jest.fn(() => ({}))
}))

let mockDatabase = {}
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: jest.fn().mockResolvedValue({
    id: 'https://llun.test/users/llun',
    username: 'llun',
    domain: 'llun.test'
  })
}))

jest.mock('@/lib/services/fitness-files', () => ({
  getPresignedFitnessFileUrl: jest.fn()
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({ get: () => undefined })
}))

const mockGetPresignedFitnessFileUrl =
  getPresignedFitnessFileUrl as jest.MockedFunction<
    typeof getPresignedFitnessFileUrl
  >

describe('Strava archive presigned URL endpoint', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: 'llun@activities.local' }
    })
  })

  it('returns 404 when ObjectStorage is not available (LocalFile)', async () => {
    mockGetPresignedFitnessFileUrl.mockResolvedValue(null)

    const req = new Request(
      'http://localhost/api/v1/settings/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: 'export.zip',
          contentType: 'application/zip',
          size: 1024
        })
      }
    )

    const response = await POST(req, { params: {} })
    expect(response.status).toBe(404)
  })

  it('returns presigned URL with archiveId when ObjectStorage is available', async () => {
    mockGetPresignedFitnessFileUrl.mockResolvedValue({
      url: 'https://s3.example.com/bucket',
      fields: {
        key: 'fitness/2024-01-01/abc.zip',
        'Content-Type': 'application/zip'
      },
      fitnessFileId: 'fitness-file-id-1'
    })

    const req = new Request(
      'http://localhost/api/v1/settings/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: 'export.zip',
          contentType: 'application/zip',
          size: 1024
        })
      }
    )

    const response = await POST(req, { params: {} })
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.presigned.url).toBe('https://s3.example.com/bucket')
    expect(body.presigned.fitnessFileId).toBe('fitness-file-id-1')
    expect(body.presigned.archiveId).toBeDefined()
    expect(typeof body.presigned.archiveId).toBe('string')
  })

  it('returns 422 on invalid input (non-zip file)', async () => {
    const req = new Request(
      'http://localhost/api/v1/settings/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: 'not-a-zip.txt', size: 1024 })
      }
    )

    const response = await POST(req, { params: {} })
    expect(response.status).toBe(422)
  })

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const req = new Request(
      'http://localhost/api/v1/settings/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: 'export.zip',
          contentType: 'application/zip',
          size: 1024
        })
      }
    )

    const response = await POST(req, { params: {} })
    expect(response.status).toBe(401)
  })
})
