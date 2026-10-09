import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import {
  ACTOR1_FOLLOWER_URL,
  ACTOR1_ID,
  seedActor1
} from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { logger } from '@/lib/utils/logger'

import { GET, PATCH } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
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

const mockEvaluateGearServiceReminders = vi.fn()
vi.mock('@/lib/services/fitness-gears/serviceReminders', () => ({
  evaluateGearServiceReminders: (...args: unknown[]) =>
    mockEvaluateGearServiceReminders(...args)
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

describe('GET /api/v1/fitness-files/[id] failure paths', () => {
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
    vi.spyOn(logger, 'warn').mockImplementation(() => logger)
    vi.spyOn(logger, 'error').mockImplementation(() => logger)
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const get = (id: string) =>
    GET(new NextRequest(`https://llun.test/api/v1/fitness-files/${id}`), {
      params: Promise.resolve({ id })
    })

  const createOwnedFile = (slug: string) =>
    database.createFitnessFile({
      actorId: ACTOR1_ID,
      path: `fitness/${slug}.fit`,
      fileName: `${slug}.fit`,
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 10
    })

  it('returns not found for an id that does not exist', async () => {
    const response = await get('no-such-file')

    expect(response.status).toBe(404)
    expect(mockGetFitnessFile).not.toHaveBeenCalled()
  })

  it('answers a stranger exactly as it answers a missing id', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })
    const file = await createOwnedFile('stranger-probe')

    const strangerResponse = await get(file!.id)
    const missingResponse = await get('no-such-file')

    expect(strangerResponse.status).toBe(404)
    expect(await strangerResponse.text()).toBe(await missingResponse.text())
    expect(mockGetFitnessFile).not.toHaveBeenCalled()
  })

  it('returns not found when the owner’s file has disappeared from storage', async () => {
    const file = await createOwnedFile('missing-from-storage')
    mockGetFitnessFile.mockResolvedValue(null)

    const response = await get(file!.id)

    expect(response.status).toBe(404)
  })

  it('redirects the owner to the storage url when the backend serves one', async () => {
    const file = await createOwnedFile('redirect-owner')
    mockGetFitnessFile.mockResolvedValue({
      type: 'redirect',
      redirectUrl: 'https://bucket.example.com/signed?x=1'
    })

    const response = await get(file!.id)

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(
      'https://bucket.example.com/signed?x=1'
    )
  })

  it('returns a server error and logs when storage throws', async () => {
    const file = await createOwnedFile('storage-throws')
    mockGetFitnessFile.mockRejectedValue(new Error('disk on fire'))

    const response = await get(file!.id)

    expect(response.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Error retrieving fitness file',
        fileId: file!.id,
        error: 'disk on fire'
      })
    )
  })

  it('returns a server error when there is no database', async () => {
    mockDatabase = null
    try {
      const response = await get('anything')
      expect(response.status).toBe(500)
    } finally {
      mockDatabase = database
    }
  })
})

describe('PATCH /api/v1/fitness-files/[id] (assign gear)', () => {
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
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const patch = (
    id: string,
    body: unknown,
    headers: Record<string, string> = { Origin: 'https://llun.test' }
  ) =>
    PATCH(
      new NextRequest(`https://llun.test/api/v1/fitness-files/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body)
      }),
      { params: Promise.resolve({ id }) }
    )

  const createFile = (actorId: string, slug: string) =>
    database.createFitnessFile({
      actorId,
      path: `fitness/${slug}.fit`,
      fileName: `${slug}.fit`,
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 10
    })

  const storedGearId = async (id: string) =>
    (await database.getFitnessFile({ id }))?.gearId

  it('attributes the owner’s activity to the owner’s gear and checks its service reminders', async () => {
    const file = await createFile(ACTOR1_ID, 'patch-assign')
    const gear = await database.createFitnessGear({
      actorId: ACTOR1_ID,
      kind: 'bike',
      name: 'Patch bike'
    })

    const response = await patch(file!.id, { gearId: gear.id })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: file!.id, gearId: gear.id })
    expect(await storedGearId(file!.id)).toBe(gear.id)
    expect(mockEvaluateGearServiceReminders).toHaveBeenCalledWith({
      database,
      actorId: ACTOR1_ID,
      gearIds: [gear.id]
    })
  })

  it.each([
    ['null', null],
    ['an empty string', '   ']
  ])('clears the attribution when gearId is %s', async (_, gearId) => {
    const file = await createFile(ACTOR1_ID, `patch-clear-${typeof gearId}`)
    const gear = await database.createFitnessGear({
      actorId: ACTOR1_ID,
      kind: 'bike',
      name: 'Clear bike'
    })
    await database.setFitnessFileGear({
      fitnessFileId: file!.id,
      actorId: ACTOR1_ID,
      gearId: gear.id
    })

    expect(await storedGearId(file!.id)).toBe(gear.id)

    const response = await patch(file!.id, { gearId })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: file!.id, gearId: null })
    expect(await storedGearId(file!.id)).toBeFalsy()
    expect(mockEvaluateGearServiceReminders).not.toHaveBeenCalled()
  })

  it('answers 404 and changes nothing for someone else’s activity', async () => {
    const file = await createFile(ACTOR2_ID, 'patch-not-mine')
    const gear = await database.createFitnessGear({
      actorId: ACTOR1_ID,
      kind: 'bike',
      name: 'My bike'
    })

    const response = await patch(file!.id, { gearId: gear.id })

    expect(response.status).toBe(404)
    expect(await storedGearId(file!.id)).toBeFalsy()
    expect(mockEvaluateGearServiceReminders).not.toHaveBeenCalled()
  })

  it('answers 404 and changes nothing for gear that belongs to someone else', async () => {
    const file = await createFile(ACTOR1_ID, 'patch-foreign-gear')
    const foreignGear = await database.createFitnessGear({
      actorId: ACTOR2_ID,
      kind: 'bike',
      name: 'Their bike'
    })

    const response = await patch(file!.id, { gearId: foreignGear.id })

    expect(response.status).toBe(404)
    expect(await storedGearId(file!.id)).toBeFalsy()
  })

  it('answers 404 for a recording device, which a ride is never done on', async () => {
    const file = await createFile(ACTOR1_ID, 'patch-device')
    const device = await database.createFitnessGear({
      actorId: ACTOR1_ID,
      kind: 'device',
      name: 'Head unit',
      deviceKey: 'name:patch head unit'
    })

    const response = await patch(file!.id, { gearId: device.id })

    expect(response.status).toBe(404)
    expect(await storedGearId(file!.id)).toBeFalsy()
  })

  it('answers 404 for an unknown activity', async () => {
    const response = await patch('no-such-file', { gearId: null })

    expect(response.status).toBe(404)
  })

  it.each([
    ['gearId is missing', {}],
    ['gearId is not a string', { gearId: 12 }]
  ])('answers 422 when %s', async (_, body) => {
    const file = await createFile(ACTOR1_ID, 'patch-invalid')

    const response = await patch(file!.id, body)

    expect(response.status).toBe(422)
  })

  it('answers 400 for a body that is not JSON', async () => {
    const file = await createFile(ACTOR1_ID, 'patch-bad-json')

    const response = await patch(file!.id, '{not json')

    expect(response.status).toBe(400)
  })

  it('rejects a cross-site request before looking at the session', async () => {
    const file = await createFile(ACTOR1_ID, 'patch-csrf')

    const response = await patch(
      file!.id,
      { gearId: null },
      { Origin: 'https://evil.example' }
    )

    expect(response.status).toBe(403)
  })

  it('redirects a signed-out caller to sign in', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const file = await createFile(ACTOR1_ID, 'patch-signed-out')

    const response = await patch(file!.id, { gearId: null })

    expect(response.status).toBe(307)
    expect(response.headers.get('Location')).toContain('/auth/signin')
  })
})
