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

jest.mock('@/app/api/auth/[...nextauth]/authOptions', () => ({
  getAuthOptions: jest.fn(() => ({}))
}))

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: []
  })
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: () => undefined
  })
}))

describe('GET /api/v1/fitness-files/by-status', () => {
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
  })

  it('returns files for public statuses', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/public-status-files`,
      url: `${ACTOR1_ID}/statuses/public-status-files`,
      actorId: ACTOR1_ID,
      text: 'Public import',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR1_FOLLOWER_URL]
    })

    const first = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/status-file-a.fit',
      fileName: 'status-file-a.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })
    const second = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/status-file-b.fit',
      fileName: 'status-file-b.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })
    await database.updateFitnessFilePrimary(first!.id, false)
    await database.updateFitnessFilePrimary(second!.id, true)

    const request = new NextRequest(
      `https://llun.test/api/v1/fitness-files/by-status?statusId=${encodeURIComponent(status.id)}`
    )
    const response = await GET(request)
    const json = (await response.json()) as { files: Array<{ id: string }> }

    expect(response.status).toBe(200)
    expect(json.files).toHaveLength(2)
    expect(json.files[0].id).toBe(second!.id)
    expect(json.files[1].id).toBe(first!.id)
  })

  it('returns not found for private statuses without authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/private-status-files`,
      url: `${ACTOR1_ID}/statuses/private-status-files`,
      actorId: ACTOR1_ID,
      text: 'Private import',
      to: [ACTOR1_FOLLOWER_URL],
      cc: []
    })

    await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/private-status-file.fit',
      fileName: 'private-status-file.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })

    const request = new NextRequest(
      `https://llun.test/api/v1/fitness-files/by-status?statusId=${encodeURIComponent(status.id)}`
    )
    const response = await GET(request)

    expect(response.status).toBe(404)
  })

  it('allows status owner to read private status files', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/private-owner-status-files`,
      url: `${ACTOR1_ID}/statuses/private-owner-status-files`,
      actorId: ACTOR1_ID,
      text: 'Owner private import',
      to: [ACTOR1_FOLLOWER_URL],
      cc: []
    })

    await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/private-owner-status-file.fit',
      fileName: 'private-owner-status-file.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })

    const request = new NextRequest(
      `https://llun.test/api/v1/fitness-files/by-status?statusId=${encodeURIComponent(status.id)}`
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
  })
})
