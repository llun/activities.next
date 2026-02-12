import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import {
  ACTOR1_FOLLOWER_URL,
  ACTOR1_ID,
  seedActor1
} from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { GET } from './route'

const mockGetServerSession = jest.fn()
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args)
}))

jest.mock('../../../auth/[...nextauth]/authOptions', () => ({
  getAuthOptions: jest.fn(() => ({}))
}))

jest.mock('../../../../../lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: []
  })
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('../../../../../lib/database', () => ({
  getDatabase: () => mockDatabase
}))

const mockGetFitnessFile = jest.fn()
jest.mock('../../../../../lib/services/fitness-files', () => ({
  getFitnessFile: (...args: unknown[]) => mockGetFitnessFile(...args)
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
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
    jest.clearAllMocks()
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

  it('serves files for public statuses without requiring a session', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/public-fitness-file`,
      url: `${ACTOR1_ID}/statuses/public-fitness-file`,
      actorId: ACTOR1_ID,
      text: 'Public fitness file',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR1_FOLLOWER_URL]
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/public-access.fit',
      fileName: 'public-access.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1024
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable'
    )
    expect(mockGetFitnessFile).toHaveBeenCalledWith(
      database,
      fitnessFile!.id,
      expect.objectContaining({ id: fitnessFile!.id })
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
