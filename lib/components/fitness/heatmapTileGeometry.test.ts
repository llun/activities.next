import { TILE_EXTENT } from '@/lib/services/fitness-files/heatmapTiles/constants'
import { tileLocalToLngLat } from '@/lib/services/fitness-files/heatmapTiles/tileCodec'

import { buildTileGeoJson, tileRunsToLngLat } from './heatmapTileGeometry'

describe('tileRunsToLngLat', () => {
  const Z = 12
  const X = 2152
  const Y = 1466

  it('places a run on the globe using its own tile coordinate', () => {
    // Deliberately ASYMMETRIC. A point on the tile diagonal has u === v, so a
    // fixture built from one cannot tell a u/v swap from a correct mapping.
    const [run] = tileRunsToLngLat(Z, X, Y, [
      { count: 3, points: [10, 200, 250, 30] }
    ])

    expect(run.count).toBe(3)
    expect(run.hidden).toBe(false)
    expect(run.points).toEqual([
      tileLocalToLngLat(Z, X, Y, 10, 200),
      tileLocalToLngLat(Z, X, Y, 250, 30)
    ])
    // And the axes really do move independently: a larger u is further east, a
    // larger v further south.
    expect(run.points[1].lng).toBeGreaterThan(run.points[0].lng)
    expect(run.points[1].lat).toBeGreaterThan(run.points[0].lat)
  })

  it('keeps every vertex inside its own tile', () => {
    const runs = tileRunsToLngLat(Z, X, Y, [
      { count: 1, points: [0, 0, TILE_EXTENT, TILE_EXTENT] }
    ])
    const north = tileLocalToLngLat(Z, X, Y, 0, 0)
    const south = tileLocalToLngLat(Z, X, Y, TILE_EXTENT, TILE_EXTENT)
    for (const point of runs[0].points) {
      expect(point.lat).toBeLessThanOrEqual(north.lat)
      expect(point.lat).toBeGreaterThanOrEqual(south.lat)
      expect(point.lng).toBeGreaterThanOrEqual(north.lng)
      expect(point.lng).toBeLessThanOrEqual(south.lng)
    }
  })

  it('puts the same tile-local numbers in different places for different tiles', () => {
    // The reason (z, x, y) has to travel with a decoded tile: losing it would
    // silently relocate every run to tile (0, 0).
    const here = tileRunsToLngLat(Z, X, Y, [{ count: 1, points: [4, 4, 8, 8] }])
    const there = tileRunsToLngLat(Z, X + 1, Y, [
      { count: 1, points: [4, 4, 8, 8] }
    ])

    expect(there[0].points[0].lng).toBeGreaterThan(here[0].points[0].lng)
    expect(there[0].points[0].lat).toBeCloseTo(here[0].points[0].lat, 12)
  })

  it('carries the privacy class through', () => {
    const [run] = tileRunsToLngLat(Z, X, Y, [
      { count: 2, hidden: true, points: [0, 0, 8, 8] }
    ])
    expect(run.hidden).toBe(true)
  })

  it('drops a run with fewer than two points', () => {
    // One vertex draws no line, and on the public path its presence alone would
    // say something happened there.
    expect(tileRunsToLngLat(Z, X, Y, [{ count: 9, points: [4, 4] }])).toEqual(
      []
    )
  })

  it('returns nothing for a tile with no runs', () => {
    expect(tileRunsToLngLat(Z, X, Y, [])).toEqual([])
  })
})

describe('buildTileGeoJson', () => {
  it('carries the count into the feature properties the paint reads', () => {
    const collection = buildTileGeoJson([
      {
        count: 7,
        hidden: false,
        points: [
          { lat: 52, lng: 5 },
          { lat: 52.1, lng: 5.1 }
        ]
      }
    ])

    expect(collection).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { count: 7, isHiddenByPrivacy: false },
          geometry: {
            type: 'LineString',
            coordinates: [
              [5, 52],
              [5.1, 52.1]
            ]
          }
        }
      ]
    })
  })

  it('writes coordinates in GeoJSON lng,lat order', () => {
    const [feature] = buildTileGeoJson([
      { count: 1, hidden: false, points: [{ lat: 1, lng: 2 }] }
    ]).features
    expect(feature.geometry.coordinates).toEqual([[2, 1]])
  })

  it('keeps the privacy flag as its own property', () => {
    const [feature] = buildTileGeoJson([
      {
        count: 1,
        hidden: true,
        points: [
          { lat: 1, lng: 2 },
          { lat: 3, lng: 4 }
        ]
      }
    ]).features
    expect(feature.properties.isHiddenByPrivacy).toBe(true)
  })
})
