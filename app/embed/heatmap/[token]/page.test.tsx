import Page from './page'

const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound()
}))

const mockDb = {
  getFitnessRouteHeatmapByShareToken: vi.fn(),
  getFitnessRouteHeatmapRegionNames: vi.fn(),
  getFitnessRouteHeatmapPyramid: vi.fn()
}
vi.mock('@/lib/database', () => ({ getDatabase: () => mockDb }))
vi.mock('@/lib/config/mapProvider', () => ({
  getPublicMapProvider: () => ({ type: 'osm' })
}))
vi.mock('./PublicHeatmapEmbed', () => ({
  PublicHeatmapEmbed: () => null
}))

describe('public heatmap embed page', () => {
  const heatmap = (region: string) => ({
    id: 'heatmap-1',
    actorId: 'https://llun.test/users/user1',
    periodType: 'all_time',
    periodKey: 'all',
    region,
    status: 'completed',
    bounds: null,
    segments: [],
    activityCount: 3,
    pointCount: 4,
    totalCount: 3,
    cursorOffset: 0,
    isPartial: false,
    shareToken: 'tok123',
    createdAt: 1,
    updatedAt: 2
  })

  const render = () =>
    Page({ params: Promise.resolve({ token: 'tok123' }) } as never)

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.getFitnessRouteHeatmapRegionNames.mockResolvedValue([])
    mockDb.getFitnessRouteHeatmapPyramid.mockResolvedValue(null)
  })

  it.each([
    {
      description: 'a rectangle rounding had collapsed',
      region: 'rect:52.00,5.00,52.00,5.00'
    },
    { description: 'an unparseable token', region: 'rect:not-a-number,5,4,6' }
  ])('refuses a share whose region is $description', async ({ region }) => {
    // See the sibling share page: such a row's untiled geometry was built with
    // no clipping at all, so embedding it publishes the whole history.
    mockDb.getFitnessRouteHeatmapByShareToken.mockResolvedValue(heatmap(region))

    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })

  it.each([
    { description: 'the world sentinel', region: '' },
    {
      description: 'a resolvable rectangle',
      region: 'rect:52.00,5.00,51.00,6.00'
    }
  ])('renders a share scoped to $description', async ({ region }) => {
    mockDb.getFitnessRouteHeatmapByShareToken.mockResolvedValue(heatmap(region))

    await expect(render()).resolves.toBeDefined()
    expect(mockNotFound).not.toHaveBeenCalled()
  })
})
