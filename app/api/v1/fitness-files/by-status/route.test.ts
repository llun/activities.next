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

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
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
    vi.clearAllMocks()
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

  it('resolves gear names for every file in one batch lookup', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/gear-status-files`,
      url: `${ACTOR1_ID}/statuses/gear-status-files`,
      actorId: ACTOR1_ID,
      text: 'Geared import',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR1_FOLLOWER_URL]
    })

    const withGear = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/gear-status-file-a.fit',
      fileName: 'gear-status-file-a.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })
    const withoutGear = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/gear-status-file-b.fit',
      fileName: 'gear-status-file-b.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })
    await database.updateFitnessFilePrimary(withGear!.id, true)
    await database.updateFitnessFilePrimary(withoutGear!.id, false)

    const gear = await database.createFitnessGear({
      actorId: ACTOR1_ID,
      kind: 'bike',
      name: 'Moots'
    })
    await database.setFitnessFileGear({
      fitnessFileId: withGear!.id,
      actorId: ACTOR1_ID,
      gearId: gear.id
    })

    const batchSpy = vi.spyOn(database, 'getFitnessGearNamesByIds')

    const request = new NextRequest(
      `https://llun.test/api/v1/fitness-files/by-status?statusId=${encodeURIComponent(status.id)}`
    )
    const response = await GET(request)
    const json = (await response.json()) as {
      files: Array<{
        id: string
        gearId: string | null
        gearName: string | null
      }>
    }

    expect(response.status).toBe(200)
    // The gear name is public here on purpose — it is what the activity's meta
    // row shows every viewer, and this reader is signed out.
    expect(json.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: withGear!.id,
          gearId: gear.id,
          gearName: 'Moots'
        }),
        expect.objectContaining({
          id: withoutGear!.id,
          gearId: null,
          gearName: null
        })
      ])
    )
    expect(batchSpy).toHaveBeenCalledTimes(1)
    batchSpy.mockRestore()
  })

  it('reports a fresh processing file as not stuck', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/processing-status-files`,
      url: `${ACTOR1_ID}/statuses/processing-status-files`,
      actorId: ACTOR1_ID,
      text: 'Processing import',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR1_FOLLOWER_URL]
    })

    const file = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/processing-status-file.fit',
      fileName: 'processing-status-file.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })
    await database.updateFitnessFileProcessingStatus(file!.id, 'processing')

    const request = new NextRequest(
      `https://llun.test/api/v1/fitness-files/by-status?statusId=${encodeURIComponent(status.id)}`
    )
    const response = await GET(request)
    const json = (await response.json()) as {
      files: Array<{ processingStatus: string; processingStuck: boolean }>
    }

    expect(response.status).toBe(200)
    expect(json.files[0].processingStatus).toBe('processing')
    expect(json.files[0].processingStuck).toBe(false)
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
