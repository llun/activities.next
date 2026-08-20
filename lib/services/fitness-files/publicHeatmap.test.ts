import { FitnessRouteHeatmap } from '@/lib/types/database/fitnessRouteHeatmap'
import { logger } from '@/lib/utils/logger'

import {
  flattenPrivacySegmentsForPublic,
  resolveSharedHeatmapRegionBounds,
  toPublicHeatmap
} from './publicHeatmap'

vi.mock('@/lib/utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

describe('flattenPrivacySegmentsForPublic', () => {
  it('removes the isHiddenByPrivacy flag while keeping points', () => {
    const result = flattenPrivacySegmentsForPublic([
      { points: [{ lat: 1, lng: 2 }] },
      {
        isHiddenByPrivacy: true,
        points: [
          { lat: 3, lng: 4 },
          { lat: 5, lng: 6 }
        ]
      }
    ])

    expect(result).toEqual([
      { points: [{ lat: 1, lng: 2 }] },
      {
        points: [
          { lat: 3, lng: 4 },
          { lat: 5, lng: 6 }
        ]
      }
    ])
    expect(result.every((segment) => !('isHiddenByPrivacy' in segment))).toBe(
      true
    )
  })

  it('returns an empty array for no segments', () => {
    expect(flattenPrivacySegmentsForPublic([])).toEqual([])
  })
})

describe('toPublicHeatmap', () => {
  const baseHeatmap: FitnessRouteHeatmap = {
    id: 'heatmap-1',
    actorId: 'https://example.test/actors/alice',
    periodType: 'all_time',
    periodKey: 'all',
    region: '',
    bounds: { minLat: 52, maxLat: 53, minLng: 4, maxLng: 5 },
    segments: [
      { points: [{ lat: 52.1, lng: 4.2 }] },
      { isHiddenByPrivacy: true, points: [{ lat: 52.2, lng: 4.3 }] }
    ],
    status: 'completed',
    activityCount: 2,
    pointCount: 2,
    totalCount: 2,
    cursorOffset: 0,
    isPartial: false,
    shareToken: 'token-1',
    createdAt: 1,
    updatedAt: 2
  }

  it('flattens privacy segments and leaves bounds untouched (no hole)', () => {
    const result = toPublicHeatmap(baseHeatmap)

    expect(result.bounds).toEqual(baseHeatmap.bounds)
    expect(result.segments).toEqual([
      { points: [{ lat: 52.1, lng: 4.2 }] },
      { points: [{ lat: 52.2, lng: 4.3 }] }
    ])
    // The original is not mutated.
    expect(baseHeatmap.segments[1].isHiddenByPrivacy).toBe(true)
  })
})

describe('resolveSharedHeatmapRegionBounds', () => {
  const share = (region: string) => ({
    id: 'heatmap-1',
    actorId: 'https://llun.test/users/user1',
    region
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the world sentinel to no clipping', () => {
    expect(resolveSharedHeatmapRegionBounds(share(''))).toEqual([])
    expect(resolveSharedHeatmapRegionBounds(share('   '))).toEqual([])
  })

  it('resolves a rect scope to its bounds', () => {
    expect(
      resolveSharedHeatmapRegionBounds(share('rect:52.00,5.00,51.00,6.00'))
    ).toEqual([{ minLat: 51, maxLat: 52, minLng: 5, maxLng: 6 }])
  })

  it.each([
    {
      description: 'a malformed coordinate',
      region: 'rect:not-a-number,5,4,6'
    },
    { description: 'a truncated token', region: 'rect:52.00,5.00' },
    { description: 'a token that is not a rect at all', region: 'nonsense' },
    // A rectangle rounding had collapsed. `serializeRegions` no longer emits
    // one, but rows written before it still hold one — and for those the
    // generation job baked the whole world into the stored geometry.
    {
      description: 'a rectangle collapsed by rounding',
      region: 'rect:52.00,5.00,52.00,5.00'
    },
    // The world token cannot be stored — serializeRegions emits '' for it — so
    // this refuses a value no writer produces, on purpose.
    { description: 'the literal world token', region: 'world' }
  ])('refuses $description rather than serving the world', ({ region }) => {
    expect(resolveSharedHeatmapRegionBounds(share(region))).toBeNull()
  })

  it('records a refusal, which is otherwise invisible from either end', () => {
    resolveSharedHeatmapRegionBounds(share('rect:not-a-number,5,4,6'))
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        heatmapId: 'heatmap-1',
        actorId: 'https://llun.test/users/user1',
        region: 'rect:not-a-number,5,4,6'
      })
    )
  })

  it('does not log when the scope resolves', () => {
    resolveSharedHeatmapRegionBounds(share(''))
    resolveSharedHeatmapRegionBounds(share('rect:52.00,5.00,51.00,6.00'))
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
