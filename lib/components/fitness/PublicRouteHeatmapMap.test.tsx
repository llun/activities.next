/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, waitFor } from '@testing-library/react'

import type { FitnessRouteHeatmapData } from '@/lib/client'
import { getPublicHeatmapTiles } from '@/lib/client'
import { TILE_EXTENT } from '@/lib/services/fitness-files/heatmapTiles/constants'

import { PublicRouteHeatmapMap } from './PublicRouteHeatmapMap'

vi.mock('@/lib/client', () => ({ getPublicHeatmapTiles: vi.fn() }))

// The map itself is exercised by its own tests; here only the fetcher the
// wrapper binds matters, so the map is reduced to something that calls it.
vi.mock('@/lib/components/fitness/RouteHeatmapMap', () => ({
  RouteHeatmapMap: ({
    fetchTiles
  }: {
    fetchTiles?: (request: {
      z: number
      tiles: Array<{ x: number; y: number }>
      version: number
    }) => Promise<unknown>
  }) => {
    if (fetchTiles) {
      void fetchTiles({ z: 12, tiles: [{ x: 1, y: 2 }], version: 3 })
    }
    return (
      <div data-testid="map" data-has-fetcher={String(Boolean(fetchTiles))} />
    )
  }
}))

const heatmap = {
  id: 'hm-1',
  region: '',
  periodType: 'all_time',
  periodKey: 'all',
  status: 'completed',
  bounds: { minLat: 52, maxLat: 52.6, minLng: 5.6, maxLng: 6.2 },
  segments: [],
  activityCount: 1,
  pointCount: 2,
  totalCount: 1,
  cursorOffset: 0,
  isPartial: false,
  createdAt: 1,
  updatedAt: 2,
  tileSource: {
    version: 3,
    minZoom: 4,
    maxZoom: 16,
    ladder: [4, 6, 8, 10, 12, 14, 16],
    extent: TILE_EXTENT
  }
} as unknown as FitnessRouteHeatmapData

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PublicRouteHeatmapMap', () => {
  it('binds the share token to every tile request', async () => {
    render(
      <PublicRouteHeatmapMap
        heatmap={heatmap}
        mapProvider={{ type: 'osm' }}
        token="tok-123"
      />
    )

    await waitFor(() => expect(getPublicHeatmapTiles).toHaveBeenCalled())
    expect(vi.mocked(getPublicHeatmapTiles).mock.calls[0][0]).toMatchObject({
      token: 'tok-123',
      z: 12,
      version: 3
    })
  })

  it('never sends a region, whatever the caller passes', async () => {
    // THE reason this wrapper exists on the public side: the server clips to
    // the shared row's own scope. A region sent from here would let a token
    // address more ground than it was cut to.
    render(
      <PublicRouteHeatmapMap
        heatmap={heatmap}
        mapProvider={{ type: 'osm' }}
        token="tok-123"
      />
    )

    await waitFor(() => expect(getPublicHeatmapTiles).toHaveBeenCalled())
    expect(
      vi.mocked(getPublicHeatmapTiles).mock.calls[0][0]
    ).not.toHaveProperty('region')
  })

  it.each([
    { description: 'a null token', token: null },
    { description: 'no token at all', token: undefined }
  ])('leaves tiles disabled for $description', ({ token }) => {
    // The owner previewing a map they have not shared: there is no public tile
    // URL to ask, so the preview stays on its untiled geometry.
    const { getByTestId } = render(
      <PublicRouteHeatmapMap
        heatmap={heatmap}
        mapProvider={{ type: 'osm' }}
        token={token}
      />
    )

    expect(getByTestId('map')).toHaveAttribute('data-has-fetcher', 'false')
    expect(getPublicHeatmapTiles).not.toHaveBeenCalled()
  })
})
