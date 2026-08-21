import {
  HEAT_VISIBLE_BASE_OPACITY,
  heatOpacityForCount
} from '@/lib/services/fitness-files/heatmapTiles/constants'
import { FitnessRouteHeatmapSegment } from '@/lib/types/database/fitnessRouteHeatmap'

import { buildHeatmapSvg, buildMapboxStaticUrl } from './staticHeatmapImage'

const bounds = { minLat: 52, maxLat: 53, minLng: 4, maxLng: 5 }

const sampleSegments: FitnessRouteHeatmapSegment[] = [
  {
    points: [
      { lat: 52.1, lng: 4.2 },
      { lat: 52.2, lng: 4.3 },
      { lat: 52.3, lng: 4.4 }
    ]
  },
  {
    points: [
      { lat: 52.5, lng: 4.6 },
      { lat: 52.6, lng: 4.7 }
    ]
  }
]

describe('buildMapboxStaticUrl', () => {
  it('builds a light-v11 static URL with path overlays and the token', () => {
    const url = buildMapboxStaticUrl({
      segments: sampleSegments,
      bounds,
      width: 600,
      height: 420,
      token: 'pk.test-token'
    })

    expect(url).not.toBeNull()
    expect(url).toContain(
      'https://api.mapbox.com/styles/v1/mapbox/light-v11/static/'
    )
    expect(url).toContain('path-2+ef4444-0.9(')
    expect(url).toContain('/auto/600x420@2x')
    expect(url).toContain('access_token=pk.test-token')
  })

  it('returns null when there is no usable geometry', () => {
    expect(
      buildMapboxStaticUrl({
        segments: [{ points: [{ lat: 1, lng: 2 }] }],
        bounds,
        width: 600,
        height: 420,
        token: 'pk.test-token'
      })
    ).toBeNull()
  })

  it('renders one long single segment on the basemap (chunked) instead of falling back', () => {
    const oneLongSegment: FitnessRouteHeatmapSegment[] = [
      {
        points: Array.from({ length: 2000 }, (_, index) => ({
          lat: 52 + index * 0.0001,
          lng: 4 + index * 0.0001
        }))
      }
    ]

    const url = buildMapboxStaticUrl({
      segments: oneLongSegment,
      bounds,
      width: 600,
      height: 420,
      token: 'pk.test-token'
    })

    // A single >budget segment must be split into multiple path overlays, not
    // dropped (which would silently fall back to the keyless SVG).
    expect(url).not.toBeNull()
    expect((url as string).length).toBeLessThanOrEqual(8192)
    expect(
      ((url as string).match(/path-2\+ef4444/g) ?? []).length
    ).toBeGreaterThan(1)
  })

  it('stays within the Mapbox URL length limit for dense input', () => {
    const dense: FitnessRouteHeatmapSegment[] = Array.from(
      { length: 200 },
      (_, segmentIndex) => ({
        points: Array.from({ length: 500 }, (_, pointIndex) => ({
          lat: 52 + segmentIndex * 0.001 + pointIndex * 0.0001,
          lng: 4 + segmentIndex * 0.001 + pointIndex * 0.0001
        }))
      })
    )

    const url = buildMapboxStaticUrl({
      segments: dense,
      bounds,
      width: 600,
      height: 420,
      token: 'pk.test-token'
    })

    expect(url).not.toBeNull()
    expect((url as string).length).toBeLessThanOrEqual(8192)
  })
})

describe('buildHeatmapSvg', () => {
  it('renders one polyline per usable segment within the viewport', () => {
    const svg = buildHeatmapSvg({
      segments: sampleSegments,
      bounds,
      width: 600,
      height: 420
    })

    expect(svg).toContain('<svg')
    expect(svg).toContain('viewBox="0 0 600 420"')
    expect((svg.match(/<polyline/g) ?? []).length).toBe(2)
    expect(svg).toContain('stroke="#ef4444"')
  })

  it('renders a plain background when there is no geometry', () => {
    const svg = buildHeatmapSvg({
      segments: [],
      bounds: null,
      width: 600,
      height: 420
    })

    expect(svg).toContain('<rect width="100%" height="100%" fill="#f8f9fa"/>')
    expect(svg).not.toContain('<polyline')
  })

  it('drops non-finite coordinates so they cannot corrupt the projection', () => {
    const svg = buildHeatmapSvg({
      segments: [
        {
          points: [
            { lat: 52.1, lng: 4.2 },
            { lat: Number.NaN, lng: 4.3 },
            { lat: 52.3, lng: Number.POSITIVE_INFINITY },
            { lat: 52.4, lng: 4.5 }
          ]
        }
      ],
      bounds,
      width: 600,
      height: 420
    })

    expect(svg).toContain('<polyline')
    expect(svg).not.toContain('NaN')
    expect(svg).not.toContain('Infinity')
  })

  it('keeps projected coordinates inside the padded viewport', () => {
    const svg = buildHeatmapSvg({
      segments: sampleSegments,
      bounds,
      width: 600,
      height: 420
    })

    const numbers = [...svg.matchAll(/points="([^"]+)"/g)].flatMap((match) =>
      match[1].split(/[ ,]/).map(Number)
    )
    expect(numbers.length).toBeGreaterThan(0)
    for (let index = 0; index < numbers.length; index += 2) {
      expect(numbers[index]).toBeGreaterThanOrEqual(0)
      expect(numbers[index]).toBeLessThanOrEqual(600)
      expect(numbers[index + 1]).toBeGreaterThanOrEqual(0)
      expect(numbers[index + 1]).toBeLessThanOrEqual(420)
    }
  })
})

describe('buildHeatmapSvg stroke shading', () => {
  const bounds = { minLat: 52, maxLat: 52.6, minLng: 5.6, maxLng: 6.2 }
  const points = [
    { lat: 52.1, lng: 5.7 },
    { lat: 52.5, lng: 6.1 }
  ]

  it('shades a tiled segment by its visit count', () => {
    // The same `heatOpacityForCount` the interactive map's ramp is generated
    // from, so a thumbnail and the map it links to read alike.
    const svg = buildHeatmapSvg({
      segments: [{ count: 6, points } as never],
      bounds,
      width: 600,
      height: 400
    })
    const expected =
      Math.round(heatOpacityForCount(6, HEAT_VISIBLE_BASE_OPACITY) * 100) / 100
    expect(svg).toContain(`stroke-opacity="${expected}"`)
  })

  it('draws a busy road more strongly than a quiet one', () => {
    const opacityOf = (count: number) => {
      const svg = buildHeatmapSvg({
        segments: [{ count, points } as never],
        bounds,
        width: 600,
        height: 400
      })
      return Number(/stroke-opacity="([\d.]+)"/.exec(svg)?.[1])
    }
    expect(opacityOf(6)).toBeGreaterThan(opacityOf(1))
  })

  it('keeps the flat opacity for untiled geometry, which has no count', () => {
    // The blob is one polyline per activity, not a shared stretch of road.
    // Inventing a count for it would be a lie about how often a road was ridden.
    const svg = buildHeatmapSvg({
      segments: [{ points }],
      bounds,
      width: 600,
      height: 400
    })
    expect(svg).toContain('stroke-opacity="0.85"')
  })
})
