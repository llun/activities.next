/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

import type { FitnessRouteHeatmapData } from '@/lib/client'
import { createMapKitTestDouble } from '@/lib/components/fitness/mapkitTestDouble'
import { TILE_EXTENT } from '@/lib/services/fitness-files/heatmapTiles/constants'
import {
  encodeTile,
  tilesForBounds
} from '@/lib/services/fitness-files/heatmapTiles/tileCodec'
import { loadMapKitModule } from '@/lib/utils/mapkit'

import { RouteHeatmapMapKit } from './RouteHeatmapMapKit'

// MapKit is a browser-only CDN script that never loads in jsdom, so the loader is
// stubbed with a never-resolving promise by default. Tests that need the post-load
// behaviour resolve it with the in-memory MapKit test double instead.
vi.mock('@/lib/utils/mapkit', () => ({
  loadMapKitModule: vi.fn(() => new Promise(() => {}))
}))

const mockLoadMapKitModule = vi.mocked(loadMapKitModule)

const heatmap: FitnessRouteHeatmapData = {
  id: 'hm-1',
  region: '',
  periodType: 'all_time',
  periodKey: 'all',
  status: 'completed',
  bounds: { minLat: 52, maxLat: 52.6, minLng: 5.6, maxLng: 6.2 },
  segments: [
    {
      points: [
        { lat: 52, lng: 5.6 },
        { lat: 52.6, lng: 6.2 }
      ]
    }
  ],
  activityCount: 12,
  pointCount: 340,
  totalCount: 20,
  cursorOffset: 20,
  isPartial: false,
  error: null,
  createdAt: 1,
  updatedAt: 2
}

const VISIBLE_STYLE = {
  strokeColor: '#ef4444',
  lineWidth: 2.8,
  strokeOpacity: 0.55
}
const HIDDEN_STYLE = {
  strokeColor: '#2563eb',
  lineWidth: 2.2,
  strokeOpacity: 0.4
}

describe('RouteHeatmapMapKit', () => {
  beforeEach(() => {
    mockLoadMapKitModule.mockReset()
    mockLoadMapKitModule.mockImplementation(
      (() => new Promise(() => {})) as never
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows the loading overlay while MapKit is still loading', () => {
    render(<RouteHeatmapMapKit heatmap={heatmap} />)

    expect(screen.getByText(/Loading map/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Fitness route heatmap')).toBeInTheDocument()
    // The provider badge only appears once MapKit finishes loading.
    expect(screen.queryByText('Apple Maps')).not.toBeInTheDocument()
  })

  it('renders the empty state when the heatmap has no drawable routes', () => {
    render(<RouteHeatmapMapKit heatmap={null} />)

    expect(
      screen.getByText('No route data for this selection')
    ).toBeInTheDocument()
  })

  it('applies the caller-supplied height class to the map surface', () => {
    const { container } = render(
      <RouteHeatmapMapKit heatmap={heatmap} heightClassName="h-dvh" />
    )

    expect(container.firstElementChild).toHaveClass('h-dvh')
  })

  it('falls back when MapKit never becomes usable', async () => {
    // The loader rejects whenever MapKit cannot authorize (an invalid Apple Maps
    // token, a rejected key), not only when the CDN script fails to load.
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.reject(
        new Error('MapKit was not initialized: Unauthorized')
      )) as never)

    const { container } = render(<RouteHeatmapMapKit heatmap={heatmap} />)

    await waitFor(() =>
      expect(
        screen.getByText('Map unavailable. Try regenerating this heatmap.')
      ).toBeInTheDocument()
    )
    expect(
      container.querySelector('[data-map-fallback-reason]')
    ).toHaveAttribute('data-map-fallback-reason', 'module-load-failed')
    expect(screen.queryByText(/Loading map/i)).not.toBeInTheDocument()
  })

  it('builds one styled polyline overlay per segment once MapKit resolves', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.resolve(double.mapkit)) as never)

    render(
      <RouteHeatmapMapKit
        heatmap={{
          ...heatmap,
          segments: [
            heatmap.segments[0],
            { ...heatmap.segments[0], isHiddenByPrivacy: true }
          ]
        }}
      />
    )

    await waitFor(() =>
      expect(double.getMap()?.currentOverlays).toHaveLength(2)
    )
    expect(
      double.overlaysOfKind('polyline').map((overlay) => overlay.styleOptions)
    ).toEqual([VISIBLE_STYLE, HIDDEN_STYLE])
    expect(await screen.findByText('Apple Maps')).toBeInTheDocument()
  })

  it('refreshes the overlays when the cached route geometry changes in place', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.resolve(double.mapkit)) as never)

    const { rerender } = render(<RouteHeatmapMapKit heatmap={heatmap} />)
    await waitFor(() =>
      expect(double.getMap()?.currentOverlays).toHaveLength(1)
    )

    // Same heatmap id and bounds, new geometry — the GL sibling repaints this via
    // `source.setData`, so MapKit must rebuild its overlays rather than go stale.
    rerender(
      <RouteHeatmapMapKit
        heatmap={{
          ...heatmap,
          updatedAt: 3,
          segments: [
            heatmap.segments[0],
            {
              isHiddenByPrivacy: true,
              points: [
                { lat: 52.1, lng: 5.7 },
                { lat: 52.5, lng: 6.1 }
              ]
            }
          ]
        }}
      />
    )

    await waitFor(() =>
      expect(double.getMap()?.currentOverlays).toHaveLength(2)
    )
    expect(double.getMap()?.removedOverlays).toHaveLength(1)
    expect(double.overlaysOfKind('polyline')).toHaveLength(3)
    // The map itself is reused, only the overlays are rebuilt.
    expect(double.maps).toHaveLength(1)
    expect(double.getMap()?.destroyCount).toBe(0)
  })
})

describe('RouteHeatmapMapKit tiled rendering', () => {
  const tileSource = {
    version: 2,
    minZoom: 4,
    maxZoom: 16,
    ladder: [4, 6, 8, 10, 12, 14, 16],
    extent: TILE_EXTENT
  }
  const tiled: FitnessRouteHeatmapData = { ...heatmap, tileSource }

  const hot = encodeTile([{ count: 20, points: [0, 0, 32, 32] }])
  const cool = encodeTile([{ count: 1, points: [8, 8, 40, 40] }])

  const fetchWith = (payload: string) =>
    vi.fn(async ({ tiles }: { tiles: Array<{ x: number; y: number }> }) => ({
      version: 2,
      tiles: Object.fromEntries(tiles.map(({ x, y }) => [`${x}:${y}`, payload]))
    }))

  // jsdom reports every box as 0x0, and the viewport reporter needs a real one
  // to derive a zoom from — without this the whole tiled path is unreachable.
  let rectSpy: ReturnType<typeof vi.spyOn> | undefined
  beforeEach(() => {
    rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        width: 800,
        height: 450,
        top: 0,
        left: 0,
        right: 800,
        bottom: 450,
        x: 0,
        y: 0,
        toJSON: () => ({})
      } as DOMRect)
  })

  afterEach(() => {
    rectSpy?.mockRestore()
  })

  it('derives its zoom from the framed region, and asks for that rung', async () => {
    // MapKit has no zoom at all. The rung has to come from the region and the
    // element width: an 800px element over the fixture's 0.6 degrees of
    // longitude is log2(800 * 360 / (256 * 0.6)) = 10.61 on the pyramid's grid,
    // which rounds UP to rung 12. Asserting only "some rung on the ladder"
    // would pass for a formula replaced by a constant.
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockResolvedValue(double.mapkit as never)
    const fetchTiles = fetchWith(cool)

    render(<RouteHeatmapMapKit heatmap={tiled} fetchTiles={fetchTiles} />)

    await waitFor(() =>
      expect(fetchTiles.mock.calls.some(([request]) => request.z === 12)).toBe(
        true
      )
    )
    expect(fetchTiles.mock.calls[0][0].version).toBe(2)
  })

  it('scales the zoom by the tile size, which coarsening would otherwise hide', async () => {
    // A 0.07 degree scope, chosen so NEITHER effect can mask the fault. The
    // correct formula gives rung 14. Dropping the TILE_SIZE divisor inflates
    // the zoom by 8 and picks rung 16 — and at a wider scope the coarsening
    // loop walks that straight back down to 14, hiding it completely (0.137
    // degrees does exactly that). Here the view still fits at z16, so the wrong
    // rung survives to the request where it can be seen.
    const tight: FitnessRouteHeatmapData = {
      ...tiled,
      id: 'hm-tight',
      bounds: { minLat: 52, maxLat: 52.07, minLng: 5.6, maxLng: 5.67 }
    }
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockResolvedValue(double.mapkit as never)
    const fetchTiles = fetchWith(cool)

    render(<RouteHeatmapMapKit heatmap={tight} fetchTiles={fetchTiles} />)

    await waitFor(() => expect(fetchTiles).toHaveBeenCalled())
    const rungs = fetchTiles.mock.calls.map(([request]) => request.z)
    expect(rungs).toContain(14)
    expect(rungs).not.toContain(16)
  })

  it('asks for the tiles the framed region actually covers', async () => {
    // Not just the right rung — the right PLACE. Before the double emitted
    // `region-change-end`, every request was for MapKit's default region off
    // the coast of Africa and no test noticed.
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockResolvedValue(double.mapkit as never)
    const fetchTiles = fetchWith(cool)

    render(<RouteHeatmapMapKit heatmap={tiled} fetchTiles={fetchTiles} />)

    await waitFor(() =>
      expect(fetchTiles.mock.calls.some(([request]) => request.z === 12)).toBe(
        true
      )
    )
    const framed = fetchTiles.mock.calls.find(([r]) => r.z === 12)![0]
    // Compared against the region the map REPORTS, not the bounds handed to it:
    // MapKit fits an assigned region to the element's aspect ratio, so a square
    // scope in a 16:9 element comes back nearly twice as wide. The request has
    // to match what the map is showing, which is the honest comparison.
    const { center, span } = double.getMap()!.region
    const expected = tilesForBounds(
      {
        minLat: center.latitude - span.latitudeDelta / 2,
        maxLat: center.latitude + span.latitudeDelta / 2,
        minLng: center.longitude - span.longitudeDelta / 2,
        maxLng: center.longitude + span.longitudeDelta / 2
      },
      12
    )
    for (const tile of framed.tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(expected.minX)
      expect(tile.x).toBeLessThanOrEqual(expected.maxX)
      expect(tile.y).toBeGreaterThanOrEqual(expected.minY)
      expect(tile.y).toBeLessThanOrEqual(expected.maxY)
    }
    expect(framed.tiles.length).toBeGreaterThan(0)
  })

  it('replaces the untiled overlays rather than drawing beside them', async () => {
    // The two describe the same roads at different fidelities; together every
    // line renders at twice its opacity. The map opens on the untiled geometry
    // — tiles cannot be asked for until a viewport exists — so this pins the
    // hand-over, not the end state.
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockResolvedValue(double.mapkit as never)

    render(<RouteHeatmapMapKit heatmap={tiled} fetchTiles={fetchWith(cool)} />)

    await waitFor(() =>
      expect(double.getMap()?.currentOverlays.length).toBeGreaterThan(0)
    )
    const untiled = [...double.getMap()!.currentOverlays]

    await waitFor(() =>
      expect(double.getMap()!.removedOverlays.length).toBeGreaterThan(0)
    )
    for (const overlay of untiled) {
      expect(double.getMap()!.currentOverlays).not.toContain(overlay)
    }
    expect(double.getMap()!.currentOverlays.length).toBeGreaterThan(0)
  })

  it('reaches the hot tier for a much-ridden run', async () => {
    // The count ramps run to 12 and 16 while opacity saturates at 6. Clamping
    // before all three would collapse every busy street onto the coolest tier.
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockResolvedValue(double.mapkit as never)

    render(<RouteHeatmapMapKit heatmap={tiled} fetchTiles={fetchWith(hot)} />)

    await waitFor(() =>
      expect(
        double.overlaysOfKind('polyline').some((overlay) => {
          const style = overlay.styleOptions as {
            strokeColor?: string
            lineWidth?: number
          }
          // Colour AND width: both ramps run past the opacity saturation point,
          // so asserting one field lets the other stay clamped.
          return style?.strokeColor === '#facc15' && style?.lineWidth === 4.2
        })
      ).toBe(true)
    )
  })

  it('frames a map that is rebuilt while tiles are already held', async () => {
    // The framing guard and the per-tile overlay keys are per-MAP. Left over
    // from a destroyed map they would make the next one open unframed, at
    // MapKit's default region, with the diff believing its tiles were attached.
    //
    // The second map's fetch never resolves, so it mounts with the FIRST map's
    // tiles still held — the state in which framing must still happen, and the
    // one a fetch that resolves promptly would hide.
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockResolvedValue(double.mapkit as never)
    const fetchTiles = fetchWith(cool)

    const { rerender } = render(
      <RouteHeatmapMapKit heatmap={tiled} fetchTiles={fetchTiles} />
    )
    await waitFor(() => expect(double.maps.length).toBe(1))
    await waitFor(() =>
      expect(double.getMap()!.removedOverlays.length).toBeGreaterThan(0)
    )

    // From here the fetch never settles, so the second map mounts with the
    // FIRST map's tiles still held — the state framing must survive, and the
    // one a promptly-resolving fetch would hide.
    fetchTiles.mockImplementation(() => new Promise(() => {}))

    // A different heatmap id tears the map down and builds a new one.
    rerender(
      <RouteHeatmapMapKit
        heatmap={{ ...tiled, id: 'hm-2' }}
        fetchTiles={fetchTiles}
      />
    )

    await waitFor(() => expect(double.maps.length).toBe(2))
    const rebuilt = double.maps[1]
    await waitFor(() =>
      expect(rebuilt.assignedRegions.length).toBeGreaterThan(0)
    )
    await waitFor(() =>
      expect(rebuilt.currentOverlays.length).toBeGreaterThan(0)
    )
  })

  it('adds and removes only the tiles that changed when the map pans', async () => {
    // MapKit gives an overlay no identity, so the per-tile keying is ours.
    // Rebuilding every overlay on each pan would drop and recreate thousands of
    // polylines for a few tiles' worth of change, and dropping the diff's
    // remove half leaks the ones that left the view.
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockResolvedValue(double.mapkit as never)

    render(<RouteHeatmapMapKit heatmap={tiled} fetchTiles={fetchWith(cool)} />)
    await waitFor(() =>
      expect(double.getMap()!.currentOverlays.length).toBeGreaterThan(0)
    )
    const map = double.getMap()!
    const before = [...map.currentOverlays]

    // Pan to a neighbouring, overlapping region.
    map.region = {
      center: { latitude: 52.5, longitude: 6.1 },
      span: { latitudeDelta: 0.6, longitudeDelta: 0.6 }
    }

    await waitFor(() => expect(map.currentOverlays).not.toEqual(before))
    // No overlay is attached twice — a diff that only added would duplicate.
    expect(new Set(map.currentOverlays).size).toBe(map.currentOverlays.length)
  })

  it('paints a busy run and a quiet one from the same tile differently', async () => {
    // The style cache keys on the resolved tier, not the raw count. Collapsing
    // it to the opacity tier would paint every busy street the coolest colour.
    const mixed = encodeTile([
      { count: 20, points: [0, 0, 32, 32] },
      { count: 1, points: [64, 64, 96, 96] }
    ])
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockResolvedValue(double.mapkit as never)

    render(<RouteHeatmapMapKit heatmap={tiled} fetchTiles={fetchWith(mixed)} />)

    await waitFor(() => {
      const colours = new Set(
        double
          .overlaysOfKind('polyline')
          .map(
            (overlay) =>
              (overlay.styleOptions as { strokeColor?: string })?.strokeColor
          )
      )
      expect(colours.has('#facc15')).toBe(true)
      expect(colours.has('#ef4444')).toBe(true)
    })
  })

  it('locks rotation, so the region never reports a superset of the view', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockResolvedValue(double.mapkit as never)

    render(<RouteHeatmapMapKit heatmap={tiled} fetchTiles={fetchWith(cool)} />)

    await waitFor(() => expect(double.getMap()).not.toBeNull())
    expect(double.getMap()!.isRotationEnabled).toBe(false)
  })

  it('stays on untiled overlays for a heatmap with no pyramid', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockResolvedValue(double.mapkit as never)
    const fetchTiles = fetchWith(cool)

    render(<RouteHeatmapMapKit heatmap={heatmap} fetchTiles={fetchTiles} />)

    await waitFor(() =>
      expect(double.getMap()?.currentOverlays.length).toBeGreaterThan(0)
    )
    expect(fetchTiles).not.toHaveBeenCalled()
  })
})
