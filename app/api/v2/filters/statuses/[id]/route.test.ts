import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { DELETE, GET } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => null
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

describe('/api/v2/filters/statuses/:id', () => {
  const database = getTestSQLDatabase()
  let statusUri: string
  let publicId: string

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database

    statusUri = `${ACTOR1_ID}/statuses/filter-status-target`
    await database.createNote({
      id: statusUri,
      url: 'https://llun.test/@test1/filter-status-target',
      actorId: ACTOR1_ID,
      text: 'filter status target',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    const storedPublicId = (
      await database.getStatusPublicIds({ statusIds: [statusUri] })
    ).get(statusUri)
    if (!storedPublicId) throw new Error('created status has no publicId')
    publicId = storedPublicId
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

  const createFilterStatus = async (actorId: string, title: string) => {
    const filter = await database.createFilter({
      actorId,
      title,
      context: ['home'],
      filterAction: 'hide',
      expiresAt: null
    })
    const row = await database.addFilterStatus({
      actorId,
      filterId: filter.id,
      statusId: statusUri
    })
    if (!row) throw new Error('filter status not created')
    return { filter, row }
  }

  const request = (id: string, method: 'GET' | 'DELETE') =>
    new NextRequest(`https://llun.test/api/v2/filters/statuses/${id}`, {
      method,
      headers: {
        Origin: 'https://llun.test',
        Referer: 'https://llun.test/'
      }
    })
  const context = (id: string) => ({ params: Promise.resolve({ id }) })

  describe('GET', () => {
    it('returns the filtered status addressed by its public id', async () => {
      const { row } = await createFilterStatus(ACTOR1_ID, 'status-get')

      const response = await GET(request(row.id, 'GET'), context(row.id))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        id: row.id,
        status_id: publicId
      })
    })

    it('answers 404 for an unknown filter status id', async () => {
      const response = await GET(request('missing', 'GET'), context('missing'))

      expect(response.status).toBe(404)
    })

    it("answers 404 for a status entry of another account's filter", async () => {
      const { row } = await createFilterStatus(ACTOR2_ID, 'status-get-foreign')

      const response = await GET(request(row.id, 'GET'), context(row.id))

      expect(response.status).toBe(404)
    })
  })

  describe('DELETE', () => {
    it('removes the entry from the filter', async () => {
      const { filter, row } = await createFilterStatus(
        ACTOR1_ID,
        'status-delete'
      )

      const response = await DELETE(request(row.id, 'DELETE'), context(row.id))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({})
      expect(
        await database.getFilterStatuses({
          actorId: ACTOR1_ID,
          filterId: filter.id
        })
      ).toEqual([])
    })

    it('answers 404 for an unknown filter status id', async () => {
      const response = await DELETE(
        request('missing', 'DELETE'),
        context('missing')
      )

      expect(response.status).toBe(404)
    })

    it("cannot remove a status entry of another account's filter", async () => {
      const { row } = await createFilterStatus(
        ACTOR2_ID,
        'status-delete-foreign'
      )

      const response = await DELETE(request(row.id, 'DELETE'), context(row.id))

      expect(response.status).toBe(404)
      expect(
        await database.getFilterStatus({ actorId: ACTOR2_ID, id: row.id })
      ).not.toBeNull()
    })
  })
})
