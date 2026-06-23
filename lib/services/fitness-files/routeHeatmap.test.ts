import { buildRouteHeatmapPayload } from '@/lib/services/fitness-files/routeHeatmap'

describe('buildRouteHeatmapPayload', () => {
  it('normalizes coordinates to six decimal places without string formatting', () => {
    const payload = buildRouteHeatmapPayload({
      privacySegments: [
        {
          isHiddenByPrivacy: false,
          points: [
            {
              lat: 52.1234564,
              lng: 4.9876544,
              isHiddenByPrivacy: false
            },
            {
              lat: 52.1234567,
              lng: 4.9876547,
              isHiddenByPrivacy: false
            }
          ]
        }
      ]
    })

    expect(payload.segments).toEqual([
      {
        points: [
          { lat: 52.123456, lng: 4.987654 },
          { lat: 52.123457, lng: 4.987655 }
        ]
      }
    ])
  })

  it('caps the stored point count at maxPoints', () => {
    // A non-collinear staircase so simplification is irrelevant here; this
    // isolates the uniform maxPoints ceiling.
    const points = Array.from({ length: 5_000 }, (_value, index) => ({
      lat: 52 + index * 0.0001 + (index % 2) * 0.0005,
      lng: 4 + index * 0.0001,
      isHiddenByPrivacy: false
    }))

    const payload = buildRouteHeatmapPayload({
      privacySegments: [{ isHiddenByPrivacy: false, points }],
      maxPoints: 1_000
    })

    // The cap actually engages: 5,000 input points are thinned to near the
    // ceiling, not collapsed to the 2-point floor.
    expect(payload.pointCount).toBeLessThanOrEqual(1_000)
    expect(payload.pointCount).toBeGreaterThan(500)
  })

  it('simplifies away collinear midpoints when a tolerance is given', () => {
    const points = [
      ...Array.from({ length: 200 }, (_value, index) => ({
        lat: 52,
        lng: 4 + index * 0.0001,
        isHiddenByPrivacy: false
      })),
      { lat: 52.05, lng: 4 + 199 * 0.0001, isHiddenByPrivacy: false }
    ]

    const payload = buildRouteHeatmapPayload({
      privacySegments: [{ isHiddenByPrivacy: false, points }],
      simplifyToleranceMeters: 2
    })

    // The 200-point collinear run collapses toward its endpoints while the final
    // corner survives, so the stored line keeps its shape with far fewer points.
    expect(payload.segments).toHaveLength(1)
    expect(payload.pointCount).toBeGreaterThanOrEqual(2)
    expect(payload.pointCount).toBeLessThan(10)
    expect(
      payload.segments[0].points.some((point) =>
        Number.isFinite(point.lat) ? Math.abs(point.lat - 52.05) < 1e-6 : false
      )
    ).toBe(true)
  })

  it('preserves the privacy flag through tolerance-driven simplification', () => {
    // A long collinear hidden run: simplification must collapse it but keep the
    // segment marked hidden, since the worker calls this path (not simplifySegments)
    // with the tolerance set.
    const points = Array.from({ length: 200 }, (_value, index) => ({
      lat: 52,
      lng: 4 + index * 0.0001,
      isHiddenByPrivacy: true
    }))

    const payload = buildRouteHeatmapPayload({
      privacySegments: [{ isHiddenByPrivacy: true, points }],
      simplifyToleranceMeters: 2
    })

    expect(payload.segments).toHaveLength(1)
    expect(payload.segments[0].isHiddenByPrivacy).toBe(true)
    expect(payload.pointCount).toBeLessThan(10)
  })
})
