import { NextRequest } from 'next/server'

import { FitnessGearActivity } from '@/lib/database/sql/fitnessGear'
import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { FitnessGear } from '@/lib/types/database/fitnessGear'
import { Status, StatusType } from '@/lib/types/domain/status'

import { GET } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    secretPhase: 'test-secret-for-encryption',
    allowEmails: [],
    allowActorDomains: []
  })
}))

type MockDatabase = Pick<
  Database,
  | 'getFitnessGear'
  | 'getFitnessGearActivities'
  | 'getStatusesByIds'
  | 'getAccountFromEmail'
  | 'getActorsForAccount'
  | 'getActorFromId'
>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined })
}))

const gear = (overrides: Partial<FitnessGear> = {}): FitnessGear => ({
  id: 'gear-1',
  actorId: ACTOR1_ID,
  kind: 'bike',
  name: 'Moots',
  defaultSports: [],
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides
})

const activity = (
  overrides: Partial<FitnessGearActivity> = {}
): FitnessGearActivity => ({
  id: 'file-1',
  statusId: 'https://llun.test/users/test1/statuses/1',
  statusPublicId: '0195f0a0-0000-7000-8000-000000000001',
  fileName: 'workout.fit',
  description: 'Morning ride',
  activityType: 'cycling',
  activityStartTime: 1_700_000_000_000,
  totalDistanceMeters: 42_600,
  ...overrides
})

const status = (id: string): Status =>
  ({
    id,
    actorId: ACTOR1_ID,
    type: StatusType.enum.Note,
    text: id,
    createdAt: 1_700_000_000_000
  }) as unknown as Status

describe('Fitness gear activities API', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessGear: vi.fn(),
    getFitnessGearActivities: vi.fn(),
    getStatusesByIds: vi.fn(),
    getAccountFromEmail: vi.fn(),
    getActorsForAccount: vi.fn(),
    getActorFromId: vi.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockDb.getAccountFromEmail.mockResolvedValue({
      id: 'account-1',
      email: seedActor1.email,
      defaultActorId: ACTOR1_ID
    })
    mockDb.getActorsForAccount.mockResolvedValue([
      { ...seedActor1, id: ACTOR1_ID }
    ])
    mockDb.getActorFromId.mockResolvedValue({ ...seedActor1, id: ACTOR1_ID })
    mockDb.getFitnessGear.mockResolvedValue(gear())
    mockDb.getFitnessGearActivities.mockResolvedValue([])
    mockDb.getStatusesByIds.mockResolvedValue([])
  })

  const params = { params: Promise.resolve({ id: 'gear-1' }) }
  const request = (search = '') =>
    new NextRequest(
      `http://llun.test/api/v1/fitness/gear/gear-1/activities${search}`,
      { method: 'GET' }
    )

  it('answers 404 for gear that is not the caller’s', async () => {
    mockDb.getFitnessGear.mockResolvedValue(null)

    const response = await GET(request(), params)

    expect(response.status).toBe(404)
    expect(mockDb.getFitnessGearActivities).not.toHaveBeenCalled()
  })

  it.each([
    {
      description: 'a device, through deviceGearId',
      kind: 'device' as const
    },
    { description: 'a bike, through gearId', kind: 'bike' as const }
  ])('serves $description', async ({ kind }) => {
    mockDb.getFitnessGear.mockResolvedValue(gear({ kind }))
    mockDb.getFitnessGearActivities.mockResolvedValue([activity()])
    mockDb.getStatusesByIds.mockResolvedValue([
      status('https://llun.test/users/test1/statuses/1')
    ])

    const response = await GET(request(), params)
    const data = await response.json()

    expect(response.status).toBe(200)
    // The kind is forwarded so the database picks the matching column; the
    // route never decides which link it means.
    expect(mockDb.getFitnessGearActivities).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      gearId: 'gear-1',
      kind,
      limit: 21,
      offset: 0
    })
    // One batched read for the whole page, in the activity order, hydrated for
    // the caller so the posts carry their own like/bookmark/reaction state.
    expect(mockDb.getStatusesByIds).toHaveBeenCalledWith({
      statusIds: ['https://llun.test/users/test1/statuses/1'],
      currentActorId: ACTOR1_ID,
      withReplies: false
    })
    expect(data.statuses).toHaveLength(1)
    expect(data.statuses[0].id).toBe('https://llun.test/users/test1/statuses/1')
    expect(data.hasMore).toBe(false)
    expect(data.nextOffset).toBe(1)
  })

  it('reports hasMore from the extra row it fetched, and does not return it', async () => {
    mockDb.getFitnessGearActivities.mockResolvedValue([
      activity({ id: 'file-1', statusId: 'status-1' }),
      activity({ id: 'file-2', statusId: 'status-2' }),
      activity({ id: 'file-3', statusId: 'status-3' })
    ])

    const response = await GET(request('?limit=2'), params)
    const data = await response.json()

    expect(mockDb.getFitnessGearActivities).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 3, offset: 0 })
    )
    // The extra row is a lookahead, not a result: it never reaches the status
    // read, let alone the response.
    expect(mockDb.getStatusesByIds).toHaveBeenCalledWith(
      expect.objectContaining({ statusIds: ['status-1', 'status-2'] })
    )
    expect(data.hasMore).toBe(true)
    expect(data.nextOffset).toBe(2)
  })

  it('passes the offset through for a later page', async () => {
    await GET(request('?limit=5&offset=10'), params)

    expect(mockDb.getFitnessGearActivities).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 6, offset: 10 })
    )
  })

  it.each([
    { description: 'a limit above the cap', search: '?limit=5000', limit: 101 },
    { description: 'a limit below one', search: '?limit=0', limit: 2 },
    { description: 'a non-numeric limit', search: '?limit=lots', limit: 21 },
    { description: 'no limit at all', search: '', limit: 21 }
  ])('clamps $description rather than failing', async ({ search, limit }) => {
    await GET(request(search), params)

    expect(mockDb.getFitnessGearActivities).toHaveBeenCalledWith(
      expect.objectContaining({ limit })
    )
  })

  it.each([
    { description: 'a negative offset', search: '?offset=-5' },
    { description: 'a non-numeric offset', search: '?offset=later' }
  ])('starts at the first page for $description', async ({ search }) => {
    await GET(request(search), params)

    expect(mockDb.getFitnessGearActivities).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0 })
    )
  })

  it('counts an activity with no post toward the offset, not the page', async () => {
    // Deleting a status only nulls `fitness_files.statusId`, so the row stays
    // and keeps counting toward the gear's totals — but there is no post left
    // to render. Paging from the statuses returned would re-request it forever.
    mockDb.getFitnessGearActivities.mockResolvedValue([
      activity({ id: 'file-1', statusId: null, statusPublicId: null }),
      activity({ id: 'file-2', statusId: 'status-2' })
    ])
    mockDb.getStatusesByIds.mockResolvedValue([status('status-2')])

    const data = await (await GET(request(), params)).json()

    expect(mockDb.getStatusesByIds).toHaveBeenCalledWith(
      expect.objectContaining({ statusIds: ['status-2'] })
    )
    expect(data.statuses).toHaveLength(1)
    expect(data.nextOffset).toBe(2)
  })

  it('continues the offset from the page it was given', async () => {
    mockDb.getFitnessGearActivities.mockResolvedValue([
      activity({ id: 'file-1', statusId: 'status-1' })
    ])
    mockDb.getStatusesByIds.mockResolvedValue([status('status-1')])

    const data = await (await GET(request('?offset=40'), params)).json()

    expect(data.nextOffset).toBe(41)
  })
})
