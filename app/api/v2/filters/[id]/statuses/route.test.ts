import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  applyFiltersToStatus,
  getActiveFilters
} from '@/lib/services/filters/applyFilters'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

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
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('/api/v2/filters/[id]/statuses', () => {
  const database = getTestSQLDatabase()
  let status: Status
  let publicId: string

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database

    const statusUri = `${ACTOR1_ID}/statuses/filter-target`
    status = await database.createNote({
      id: statusUri,
      url: 'https://llun.test/@test1/filter-target',
      actorId: ACTOR1_ID,
      text: 'filter target',
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

  const createFilter = async (title: string) =>
    database.createFilter({
      actorId: ACTOR1_ID,
      title,
      context: ['home'],
      filterAction: 'hide',
      expiresAt: null
    })

  const postRequest = (filterId: string, body: unknown) =>
    new NextRequest(`https://llun.test/api/v2/filters/${filterId}/statuses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://llun.test',
        Referer: 'https://llun.test/'
      },
      body: JSON.stringify(body)
    })

  it.each([
    { description: 'publicId', idForm: () => publicId },
    { description: 'legacy colon form', idForm: () => urlToId(status.id) },
    { description: 'raw uri', idForm: () => status.id }
  ])(
    'stores a $description status id in resolved form and matches it',
    async ({ idForm }) => {
      const filter = await createFilter(`Filter ${idForm()}`)

      const response = await POST(
        postRequest(filter.id, { status_id: idForm() }),
        {
          params: Promise.resolve({ id: filter.id })
        }
      )
      expect(response.status).toBe(200)

      const stored = await database.getFilterStatuses({
        actorId: ACTOR1_ID,
        filterId: filter.id
      })
      expect(stored?.map((entry) => entry.statusId)).toEqual([status.id])

      const activeFilters = await getActiveFilters(database, ACTOR1_ID, 'home')
      const results = applyFiltersToStatus(
        status,
        activeFilters.filter((record) => record.filter.id === filter.id)
      )
      expect(results).toHaveLength(1)
      expect(results[0].status_matches).toEqual([status.id])
    }
  )

  it('keeps matching a row already stored in the legacy colon form', async () => {
    const filter = await createFilter('Pre-existing colon form row')
    await database.addFilterStatus({
      actorId: ACTOR1_ID,
      filterId: filter.id,
      statusId: urlToId(status.id)
    })

    const activeFilters = await getActiveFilters(database, ACTOR1_ID, 'home')
    const results = applyFiltersToStatus(
      status,
      activeFilters.filter((record) => record.filter.id === filter.id)
    )
    expect(results).toHaveLength(1)
    expect(results[0].status_matches).toEqual([urlToId(status.id)])
  })

  it('returns 422 when status_id is missing', async () => {
    const filter = await createFilter('No status id')
    const response = await POST(postRequest(filter.id, {}), {
      params: Promise.resolve({ id: filter.id })
    })
    expect(response.status).toBe(422)
  })
})
