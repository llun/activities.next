import { logger } from '@/lib/utils/logger'

import Page, { generateMetadata } from './page'

vi.mock('@/lib/utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound()
}))

const mockDb = {
  getFitnessRouteHeatmapByShareToken: vi.fn(),
  getActorFromId: vi.fn(),
  getFitnessRouteHeatmapRegionNames: vi.fn(),
  getFitnessRouteHeatmapPyramid: vi.fn()
}
vi.mock('@/lib/database', () => ({ getDatabase: () => mockDb }))
vi.mock('@/lib/config', () => ({ getBaseURL: () => 'https://llun.test' }))
vi.mock('@/lib/config/mapProvider', () => ({
  getPublicMapProvider: () => ({ type: 'osm' })
}))
vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: async () => ({
    instance: { name: 'llun.social' },
    registrations: { open: true }
  })
}))
vi.mock('./SharedHeatmapPage', () => ({
  SharedHeatmapPage: () => null
}))

describe('shared heatmap page', () => {
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

  // A fresh token per case: `loadSharedHeatmap` is memoized with React `cache`
  // so one request's metadata and page share their reads, and reusing a token
  // across cases would risk answering the next one from the previous one's row.
  let token = 'tok123'

  const render = () => Page({ params: Promise.resolve({ token }) } as never)

  const metadata = () =>
    generateMetadata({ params: Promise.resolve({ token }) } as never)

  let tokenSeq = 0

  beforeEach(() => {
    vi.clearAllMocks()
    tokenSeq += 1
    token = `tok${tokenSeq}`
    mockDb.getActorFromId.mockResolvedValue(null)
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
    // The stored geometry for such a row was built with NO clipping — the job
    // reads the same unresolvable region as world scope — so rendering it
    // publishes the actor's whole history under a small area's label. There is
    // nothing left to clip; refusing is the only remedy short of regenerating.
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

  it('still renders when the pyramid read fails, and records it', async () => {
    // Tile work must never cost the reader the untiled map. Degrading silently
    // would make a pyramid-table outage look identical to an actor with no
    // build at all.
    mockDb.getFitnessRouteHeatmapByShareToken.mockResolvedValue(heatmap(''))
    mockDb.getFitnessRouteHeatmapPyramid.mockRejectedValue(
      new Error('pyramid table unavailable')
    )

    await expect(render()).resolves.toBeDefined()
    expect(mockNotFound).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        heatmapId: 'heatmap-1',
        err: expect.objectContaining({ message: 'pyramid table unavailable' })
      })
    )
  })

  describe('generateMetadata', () => {
    it('builds a link preview card for a renderable share', async () => {
      mockDb.getFitnessRouteHeatmapByShareToken.mockResolvedValue(heatmap(''))

      const result = await metadata()

      expect(result.openGraph?.images).toEqual([
        expect.objectContaining({
          url: `https://llun.test/embed/heatmap/${token}/image?w=1200&h=600&format=png`
        })
      ])
      expect(result.openGraph?.url).toBe(
        `https://llun.test/u/heatmaps/${token}`
      )
      expect(result.openGraph?.siteName).toBe('llun.social')
      expect(result.robots).toEqual({ index: false, follow: false })
    })

    it.each([
      {
        description: 'a revoked token',
        row: null
      },
      {
        description: 'a share re-queued for generation',
        row: { ...heatmap(''), status: 'generating', segments: null }
      },
      {
        description: 'a region that cannot be resolved',
        row: heatmap('rect:not-a-number,5,4,6')
      }
    ])('publishes no card for $description', async ({ row }) => {
      // Each of these renders as a 404, so a card would describe a page that
      // refuses to serve it — the region name, the handle and a thumbnail.
      mockDb.getFitnessRouteHeatmapByShareToken.mockResolvedValue(row)

      const result = await metadata()

      expect(result.openGraph).toBeUndefined()
      expect(result.twitter).toBeUndefined()
      expect(result.title).toBe('Route heatmap')
      expect(result.robots).toEqual({ index: false, follow: false })
    })

    it('describes the same share the page renders', async () => {
      // Both surfaces go through the one loader, so the card cannot describe a
      // share the page would refuse — the failure this replaced was a second
      // lookup path that drifted from the first.
      //
      // The loader is additionally memoized with React `cache`, so Next runs
      // those reads once per request rather than once per surface. That memo is
      // deliberately NOT asserted here: `cache` only dedupes inside a React
      // request scope, which Vitest has none of, so a call-count assertion
      // would be testing the harness rather than the route.
      mockDb.getFitnessRouteHeatmapByShareToken.mockResolvedValue(heatmap(''))

      const [card] = await Promise.all([metadata(), render()])

      expect(card.openGraph?.url).toBe(`https://llun.test/u/heatmaps/${token}`)
      expect(mockNotFound).not.toHaveBeenCalled()
    })
  })
})
