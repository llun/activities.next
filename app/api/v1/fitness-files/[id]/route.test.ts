import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import {
  ACTOR1_FOLLOWER_URL,
  ACTOR1_ID,
  seedActor1
} from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { GET } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: []
  })
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

const mockGetFitnessFile = vi.fn()
vi.mock('@/lib/services/fitness-files', () => ({
  getFitnessFile: (...args: unknown[]) => mockGetFitnessFile(...args)
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined
  })
}))

describe('GET /api/v1/fitness-files/[id]', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetFitnessFile.mockResolvedValue({
      type: 'buffer',
      contentType: 'application/vnd.ant.fit',
      buffer: Buffer.from('fit-data')
    })
  })

  const createRequest = () =>
    new NextRequest('https://llun.test/api/v1/fitness-files/file-id', {
      method: 'GET'
    })

  const createPublicFitnessFile = async (slug: string) => {
    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/${slug}`,
      url: `${ACTOR1_ID}/statuses/${slug}`,
      actorId: ACTOR1_ID,
      text: 'Public fitness file',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR1_FOLLOWER_URL]
    })

    return database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: `fitness/${slug}.fit`,
      fileName: `${slug}.fit`,
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1024
    })
  }

  // The raw upload carries the whole track, including the ends a privacy
  // location trims off the route map and the route-data response, so a public
  // activity must not hand it out. This used to answer 200 with a year-long
  // immutable cache header.
  it('returns not found for a public status file without a session', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const fitnessFile = await createPublicFitnessFile('public-fitness-file')

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })

    expect(response.status).toBe(404)
    expect(mockGetFitnessFile).not.toHaveBeenCalled()
  })

  it('returns not found for a public status file to a signed-in non-owner', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })

    const fitnessFile = await createPublicFitnessFile('public-non-owner-file')

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })

    expect(response.status).toBe(404)
    expect(mockGetFitnessFile).not.toHaveBeenCalled()
  })

  it('serves a public status file to its owner', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const fitnessFile = await createPublicFitnessFile('public-owner-file')

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })

    expect(response.status).toBe(200)
    // Never `public`, whatever the status visibility: a shared cache that kept
    // these bytes would outlive the visibility change meant to withdraw them.
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="public-owner-file.fit"; filename*=UTF-8''public-owner-file.fit`
    )
    expect(mockGetFitnessFile).toHaveBeenCalledWith(
      database,
      fitnessFile!.id,
      expect.objectContaining({ id: fitnessFile!.id })
    )
  })

  it('neutralises a stored file name that would break out of the header', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      path: 'fitness/quoted-name.fit',
      fileName: 'ru"n; attachment; filename="evil.html',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1024
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })
    const contentDisposition = response.headers.get('Content-Disposition') ?? ''

    expect(response.status).toBe(200)
    // One quoted-string and one RFC 5987 parameter, and no stray `"` in between
    // that could close the first early and smuggle a second filename.
    expect(contentDisposition).toBe(
      `attachment; filename="ru_n_ attachment_ filename_evil.html"; filename*=UTF-8''ru%22n%3B%20attachment%3B%20filename%3D%22evil.html`
    )
  })

  it('returns not found for private status files without a session', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/private-fitness-file`,
      url: `${ACTOR1_ID}/statuses/private-fitness-file`,
      actorId: ACTOR1_ID,
      text: 'Private fitness file',
      to: [ACTOR1_FOLLOWER_URL],
      cc: []
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/private-access.fit',
      fileName: 'private-access.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1024
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })

    expect(response.status).toBe(404)
    expect(mockGetFitnessFile).not.toHaveBeenCalled()
  })

  it('allows owner access to unlinked uploaded files', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      path: 'fitness/draft-owner.fit',
      fileName: 'draft-owner.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 2048
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mockGetFitnessFile).toHaveBeenCalled()
  })
})
