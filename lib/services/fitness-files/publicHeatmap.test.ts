import { FitnessRouteHeatmap } from '@/lib/types/database/fitnessRouteHeatmap'

import {
  flattenPrivacySegmentsForPublic,
  toPublicHeatmap
} from './publicHeatmap'

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
