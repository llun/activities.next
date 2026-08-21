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

import { GET, POST } from './route'

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

      // Stored resolved so matching works, emitted as the publicId the rest of
      // the API addresses the status by — the write side resolves, the read side
      // normalises.
      const stored = await database.getFilterStatuses({
        actorId: ACTOR1_ID,
        filterId: filter.id
      })
      expect(stored?.map((entry) => entry.statusId)).toEqual([status.id])
      expect(await response.json()).toMatchObject({ status_id: publicId })

      const activeFilters = await getActiveFilters(database, ACTOR1_ID, 'home')
      const results = applyFiltersToStatus(
        status,
        activeFilters.filter((record) => record.filter.id === filter.id)
      )
      expect(results).toHaveLength(1)
      expect(results[0].status_matches).toEqual([publicId])
      // The filter carried alongside the match must name the same status, or
      // the one document disagrees with itself.
      expect(
        results[0].filter.statuses.map((entry) => entry.status_id)
      ).toEqual([publicId])
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
    expect(results[0].status_matches).toEqual([publicId])
    expect(results[0].filter.statuses.map((entry) => entry.status_id)).toEqual([
      publicId
    ])
  })

  it('emits one id form for a filter holding both a pre-existing and a newly written row', async () => {
    const filter = await createFilter('Mixed storage forms')
    // A row written before the write side resolved client ids: colon form.
    await database.addFilterStatus({
      actorId: ACTOR1_ID,
      filterId: filter.id,
      statusId: urlToId(status.id)
    })
    // A row written through the route today: the resolved status URI.
    const postResponse = await POST(
      postRequest(filter.id, { status_id: publicId }),
      { params: Promise.resolve({ id: filter.id }) }
    )
    expect(postResponse.status).toBe(200)

    const stored = await database.getFilterStatuses({
      actorId: ACTOR1_ID,
      filterId: filter.id
    })
    // The two rows genuinely differ on disk, so this is not a vacuous check.
    expect(new Set(stored?.map((entry) => entry.statusId))).toEqual(
      new Set([urlToId(status.id), status.id])
    )

    const listResponse = await GET(
      new NextRequest(
        `https://llun.test/api/v2/filters/${filter.id}/statuses`,
        { headers: { Origin: 'https://llun.test' } }
      ),
      { params: Promise.resolve({ id: filter.id }) }
    )
    expect(listResponse.status).toBe(200)
    const listed = (await listResponse.json()) as { status_id: string }[]
    expect(listed).toHaveLength(2)
    expect(new Set(listed.map((entry) => entry.status_id))).toEqual(
      new Set([publicId])
    )

    const activeFilters = await getActiveFilters(database, ACTOR1_ID, 'home')
    const results = applyFiltersToStatus(
      status,
      activeFilters.filter((record) => record.filter.id === filter.id)
    )
    expect(results).toHaveLength(1)
    expect(results[0].status_matches).toEqual([publicId, publicId])
    expect(results[0].filter.statuses.map((entry) => entry.status_id)).toEqual([
      publicId,
      publicId
    ])
  })

  it('returns 422 when status_id is missing', async () => {
    const filter = await createFilter('No status id')
    const response = await POST(postRequest(filter.id, {}), {
      params: Promise.resolve({ id: filter.id })
    })
    expect(response.status).toBe(422)
  })
})
