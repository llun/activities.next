import {
  TILE_EXTENT,
  TILE_LADDER_ZOOMS,
  TILE_MAX_ZOOM,
  TILE_MIN_ZOOM
} from './constants'
import { buildHeatmapTileSource, isPyramidVariantHeatmap } from './tileSource'

describe('isPyramidVariantHeatmap', () => {
  it.each([
    {
      description: 'all time, every sport',
      heatmap: { periodType: 'all_time' },
      expected: true
    },
    {
      description: 'all time, one sport',
      heatmap: { periodType: 'all_time', activityType: 'running' },
      expected: false
    },
    {
      description: 'one year, every sport',
      heatmap: { periodType: 'yearly' },
      expected: false
    },
    {
      description: 'one month, every sport',
      heatmap: { periodType: 'monthly' },
      expected: false
    },
    {
      description: 'an explicitly null sport',
      heatmap: { periodType: 'all_time', activityType: null },
      expected: true
    },
    {
      description: 'a blank sport, which the job would read as a filter',
      heatmap: { periodType: 'all_time', activityType: '' },
      expected: false
    }
  ])('answers $expected for $description', ({ heatmap, expected }) => {
    expect(isPyramidVariantHeatmap(heatmap)).toBe(expected)
  })
})

// The predicate is a privacy gate on the public tile route, so a value the job
// and this side would read differently must fail CLOSED. The job builds only for
// `activityType === null`; a stored empty string would filter to nothing there
// while reading as "no filter" here, which would serve a whole history behind a
// row showing none of it. The API cannot store one today — this pins that the
// disagreement stays impossible rather than merely unlikely.
describe('buildHeatmapTileSource', () => {
  const allTime = { periodType: 'all_time' }
  const completed = { status: 'completed', version: 3 }

  it('describes the ladder for a completed pyramid on the variant it covers', () => {
    expect(buildHeatmapTileSource(allTime, completed)).toEqual({
      version: 3,
      minZoom: TILE_MIN_ZOOM,
      maxZoom: TILE_MAX_ZOOM,
      ladder: [...TILE_LADDER_ZOOMS],
      extent: TILE_EXTENT
    })
  })

  it('hands out a copy of the ladder, not the shared constant', () => {
    const source = buildHeatmapTileSource(allTime, completed)
    expect(source?.ladder).not.toBe(TILE_LADDER_ZOOMS)
  })

  it.each([
    {
      description: 'a heatmap filtered to one sport',
      heatmap: { periodType: 'all_time', activityType: 'cycling' },
      pyramid: completed
    },
    {
      description: 'a heatmap filtered to one year',
      heatmap: { periodType: 'yearly' },
      pyramid: completed
    },
    {
      description: 'a heatmap filtered to a blank sport',
      heatmap: { periodType: 'all_time', activityType: '' },
      pyramid: completed
    },
    { description: 'no pyramid', heatmap: allTime, pyramid: null },
    {
      description: 'a build still running',
      heatmap: allTime,
      pyramid: { status: 'generating', version: 3 }
    },
    {
      description: 'a failed build',
      heatmap: allTime,
      pyramid: { status: 'failed', version: 3 }
    },
    {
      description: 'a row that never built',
      heatmap: allTime,
      pyramid: { status: 'completed', version: 0 }
    }
  ])('has no tile source for $description', ({ heatmap, pyramid }) => {
    expect(buildHeatmapTileSource(heatmap, pyramid)).toBeNull()
  })
})
