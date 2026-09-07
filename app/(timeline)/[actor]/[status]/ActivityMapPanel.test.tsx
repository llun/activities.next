/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FitnessRouteSample, FitnessRouteSegment } from '@/lib/client'
import type { Attachment } from '@/lib/types/domain/attachment'
import { loadMapboxModule } from '@/lib/utils/mapbox'
import { loadMaplibreModule } from '@/lib/utils/maplibre'

import {
  ActivityMapPanel,
  MAP_ACTIVE_POINT_SOURCE_ID,
  MAP_LOAD_TIMEOUT_MS,
  MAP_ROUTE_HIDDEN_HIT_LAYER_ID,
  MAP_ROUTE_SOURCE_ID
} from './ActivityMapPanel'

vi.mock('@/lib/utils/mapbox', () => ({
  loadMapboxModule: vi.fn()
}))

vi.mock('@/lib/utils/maplibre', () => ({
  OPENFREEMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/bright',
  OPENFREEMAP_HEATMAP_STYLE_URL:
    'https://tiles.openfreemap.org/styles/positron',
  loadMaplibreModule: vi.fn()
}))

vi.mock('@/lib/components/posts/media', () => ({
  Media: ({ attachment }: { attachment: Attachment }) => (
    <div data-testid="media-attachment" data-attachment-id={attachment.id} />
  )
}))

vi.mock('@/lib/components/fitness/ActivityRouteMapKit', () => ({
  ActivityRouteMapKit: ({
    routeSegments,
    routeSamples,
    highlightedElapsedSeconds,
    onUnavailable
  }: {
    routeSegments: FitnessRouteSegment[]
    routeSamples: FitnessRouteSample[]
    highlightedElapsedSeconds?: number | null
    onUnavailable?: () => void
  }) => (
    <div
      data-testid="mapkit-route-map"
      data-segments-count={routeSegments.length}
      data-samples-count={routeSamples.length}
      data-highlighted-elapsed={
        typeof highlightedElapsedSeconds === 'number'
          ? String(highlightedElapsedSeconds)
          : ''
      }
    >
      <button
        type="button"
        data-testid="mapkit-trigger-unavailable"
        onClick={onUnavailable}
      >
        Fail MapKit
      </button>
    </div>
  )
}))

const sampleRoute: FitnessRouteSample[] = [
  {
    lat: 37.7749,
    lng: -122.4194,
    timestamp: 1716806520,
    elapsedSeconds: 0,
    altitude: 10,
    heartRate: 110,
    speed: 18
  },
  {
    lat: 37.7755,
    lng: -122.418,
    timestamp: 1716806580,
    elapsedSeconds: 60,
    altitude: 12,
    heartRate: 120,
    speed: 20
  },
  {
    lat: 37.776,
    lng: -122.417,
    timestamp: 1716806640,
    elapsedSeconds: 120,
    altitude: 15,
    heartRate: 130,
    speed: 22
  }
]

const sampleAttachment: Attachment = {
  id: 'att-map-1',
  actorId: 'actor-1',
  statusId: 'status-1',
  type: 'Document',
  mediaType: 'image/png',
  url: 'https://media.activities.local/map.png',
  width: 800,
  height: 600,
  name: 'Route map',
  blurhash: 'U4720h00_3?b_3%M?bof_3of?b_3?bof?bof',
  createdAt: 1716806520,
  updatedAt: 1716806520
}

interface GlMockHarness {
  map: {
    addSource: ReturnType<typeof vi.fn>
    addLayer: ReturnType<typeof vi.fn>
    once: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    getCanvas: ReturnType<typeof vi.fn>
    getSource: ReturnType<typeof vi.fn>
    getZoom: ReturnType<typeof vi.fn>
    fitBounds: ReturnType<typeof vi.fn>
    setMinZoom: ReturnType<typeof vi.fn>
    setMaxBounds: ReturnType<typeof vi.fn>
    zoomIn: ReturnType<typeof vi.fn>
    zoomOut: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
  }
  canvas: HTMLCanvasElement
  handlers: Map<string, (event: { point: { x: number; y: number } }) => void>
  layers: string[]
  sources: Map<string, { setData: ReturnType<typeof vi.fn> }>
  MapConstructor: ReturnType<typeof vi.fn>
}

const setupGlMock = (autoFireLoad = true): GlMockHarness => {
  const handlers = new Map<
    string,
    (event: { point: { x: number; y: number } }) => void
  >()
  const layers: string[] = []
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>()
  const canvas = document.createElement('canvas')

  const map = {
    addSource: vi.fn((id: string, _source: Record<string, unknown>) => {
      const sourceObj = { setData: vi.fn() }
      sources.set(id, sourceObj)
    }),
    addLayer: vi.fn((layer: { id: string }) => {
      layers.push(layer.id)
    }),
    once: vi.fn((event: string, listener: () => void) => {
      if (event === 'load' && autoFireLoad) {
        listener()
      }
    }),
    on: vi.fn(
      (
        event: string,
        layerId: string,
        listener: (payload: { point: { x: number; y: number } }) => void
      ) => {
        handlers.set(`${event}:${layerId}`, listener)
      }
    ),
    getCanvas: vi.fn(() => canvas),
    getSource: vi.fn((id: string) => sources.get(id)),
    getZoom: vi.fn(() => 14),
    fitBounds: vi.fn(),
    setMinZoom: vi.fn(),
    setMaxBounds: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    remove: vi.fn()
  }

  const MapConstructor = vi.fn(function MapStub() {
    return map
  })

  class LngLatBoundsStub {
    sw: [number, number]
    ne: [number, number]
    constructor(sw: [number, number], ne: [number, number]) {
      this.sw = sw
      this.ne = ne
    }
    extend() {
      return this
    }
  }

  vi.mocked(loadMaplibreModule).mockResolvedValue({
    Map: MapConstructor,
    LngLatBounds: LngLatBoundsStub
  } as never)

  vi.mocked(loadMapboxModule).mockResolvedValue({
    Map: MapConstructor,
    LngLatBounds: LngLatBoundsStub
  } as never)

  return { map, canvas, handlers, layers, sources, MapConstructor }
}

describe('ActivityMapPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('no route & fallback rendering', () => {
    it('renders static attachment preview when no route exists and attachment is provided', () => {
      const onOpenMap = vi.fn()
      render(
        <ActivityMapPanel
          mapAttachment={sampleAttachment}
          routeSamples={[]}
          routeSegments={[]}
          mapProvider={{ type: 'osm' }}
          onOpenMap={onOpenMap}
        />
      )

      expect(screen.getByTestId('media-attachment')).toBeInTheDocument()
      expect(screen.getByLabelText('Open route map image')).toBeInTheDocument()

      fireEvent.click(screen.getByLabelText('Open route map image'))
      expect(onOpenMap).toHaveBeenCalledTimes(1)
    })

    it('renders "Map preview unavailable" when neither route nor attachment is available', () => {
      render(
        <ActivityMapPanel
          routeSamples={[]}
          routeSegments={[]}
          mapProvider={{ type: 'osm' }}
        />
      )

      expect(screen.getByText('Map preview unavailable')).toBeInTheDocument()
    })

    it('renders route data loading banner when route is loading and no map is active', () => {
      render(
        <ActivityMapPanel
          routeSamples={[]}
          routeSegments={[]}
          isRouteDataLoading={true}
          mapProvider={{ type: 'osm' }}
        />
      )

      expect(
        screen.getByText('Loading interactive route...')
      ).toBeInTheDocument()
    })

    it('renders route data error banner when routeDataError is passed', () => {
      render(
        <ActivityMapPanel
          routeSamples={[]}
          routeSegments={[]}
          routeDataError="Could not load route data"
          mapProvider={{ type: 'osm' }}
        />
      )

      expect(screen.getByText('Could not load route data')).toBeInTheDocument()
    })
  })

  describe('supported providers & valid routes', () => {
    it('renders Apple MapKit when mapProvider is apple', () => {
      render(
        <ActivityMapPanel
          routeSamples={sampleRoute}
          mapProvider={{ type: 'apple' }}
          highlightedElapsedSeconds={60}
        />
      )

      const mapkit = screen.getByTestId('mapkit-route-map')
      expect(mapkit).toBeInTheDocument()
      expect(mapkit).toHaveAttribute('data-highlighted-elapsed', '60')
      expect(mapkit).toHaveAttribute('data-samples-count', '3')
      expect(mapkit).toHaveAttribute('data-segments-count', '1')
    })

    it('initializes GL map for OSM provider and registers layers, sources, and bounds', async () => {
      const { map, layers, MapConstructor } = setupGlMock()

      render(
        <ActivityMapPanel
          routeSamples={sampleRoute}
          mapProvider={{ type: 'osm' }}
        />
      )

      await waitFor(() => {
        expect(MapConstructor).toHaveBeenCalledTimes(1)
      })

      expect(screen.getByLabelText('Activity route map')).toBeInTheDocument()
      expect(map.addSource).toHaveBeenCalledWith(
        MAP_ROUTE_SOURCE_ID,
        expect.objectContaining({
          type: 'geojson'
        })
      )
      expect(layers).toContain('activity-route-line-visible')
      expect(layers).toContain('activity-route-line-hidden')
      expect(layers).toContain(MAP_ROUTE_HIDDEN_HIT_LAYER_ID)
      expect(layers).toContain('activity-active-point-ring')
      expect(layers).toContain('activity-active-point-core')

      expect(map.fitBounds).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          padding: 28,
          maxZoom: 16,
          duration: 0
        })
      )
      expect(map.setMinZoom).toHaveBeenCalled()
      expect(map.setMaxBounds).toHaveBeenCalled()

      // Zoom controls
      const zoomInBtn = screen.getByLabelText('Zoom in map')
      const zoomOutBtn = screen.getByLabelText('Zoom out map')
      fireEvent.click(zoomInBtn)
      expect(map.zoomIn).toHaveBeenCalledWith({ duration: 250 })
      fireEvent.click(zoomOutBtn)
      expect(map.zoomOut).toHaveBeenCalledWith({ duration: 250 })
    })

    it('initializes Mapbox provider with access token', async () => {
      const { MapConstructor } = setupGlMock()

      render(
        <ActivityMapPanel
          routeSamples={sampleRoute}
          mapProvider={{ type: 'mapbox', accessToken: 'mapbox-token-123' }}
        />
      )

      await waitFor(() => {
        expect(MapConstructor).toHaveBeenCalledTimes(1)
      })
      expect(MapConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'mapbox-token-123'
        })
      )
    })

    it('normalizes raw samples into a single segment when routeSegments is omitted', async () => {
      const { map } = setupGlMock()

      render(
        <ActivityMapPanel
          routeSamples={sampleRoute}
          mapProvider={{ type: 'osm' }}
        />
      )

      await waitFor(() => {
        expect(map.addSource).toHaveBeenCalled()
      })

      const routeCall = map.addSource.mock.calls.find(
        ([id]) => id === MAP_ROUTE_SOURCE_ID
      )
      expect(routeCall).toBeDefined()
      const data = routeCall![1].data as {
        type: string
        features: Array<{ properties: { isHiddenByPrivacy: boolean } }>
      }
      expect(data.features).toHaveLength(1)
      expect(data.features[0].properties.isHiddenByPrivacy).toBe(false)
    })
  })

  describe('privacy segments & hint interactions', () => {
    const privacySegments: FitnessRouteSegment[] = [
      {
        isHiddenByPrivacy: false,
        samples: sampleRoute.slice(0, 2)
      },
      {
        isHiddenByPrivacy: true,
        samples: sampleRoute.slice(1)
      }
    ]

    it('shows description for privacy segments and adds hidden hit layer', async () => {
      const { layers } = setupGlMock()

      render(
        <ActivityMapPanel
          routeSamples={sampleRoute}
          routeSegments={privacySegments}
          mapProvider={{ type: 'osm' }}
        />
      )

      await waitFor(() => {
        expect(layers).toContain(MAP_ROUTE_HIDDEN_HIT_LAYER_ID)
      })

      expect(
        screen.getByText(/hidden sections are drawn in green/i)
      ).toBeInTheDocument()
    })

    it('handles mousemove and mouseleave over privacy hit layer', async () => {
      const { canvas, handlers } = setupGlMock()

      render(
        <ActivityMapPanel
          routeSamples={sampleRoute}
          routeSegments={privacySegments}
          mapProvider={{ type: 'osm' }}
        />
      )

      await waitFor(() => {
        expect(handlers.has(`mousemove:${MAP_ROUTE_HIDDEN_HIT_LAYER_ID}`)).toBe(
          true
        )
      })

      expect(screen.queryByTestId('route-privacy-hint')).not.toBeInTheDocument()

      await act(async () => {
        handlers.get(`mousemove:${MAP_ROUTE_HIDDEN_HIT_LAYER_ID}`)?.({
          point: { x: 50, y: 80 }
        })
      })

      const hint = screen.getByTestId('route-privacy-hint')
      expect(hint).toHaveTextContent('Hidden from other viewers')
      expect(hint).toHaveStyle({ left: '50px', top: '80px' })
      expect(canvas.style.cursor).toBe('help')

      await act(async () => {
        handlers.get(`mouseleave:${MAP_ROUTE_HIDDEN_HIT_LAYER_ID}`)?.({
          point: { x: 0, y: 0 }
        })
      })

      expect(screen.queryByTestId('route-privacy-hint')).not.toBeInTheDocument()
      expect(canvas.style.cursor).toBe('')
    })

    it('retires tap-opened privacy hint after timeout on touch pointer', async () => {
      const { handlers } = setupGlMock()

      render(
        <ActivityMapPanel
          routeSamples={sampleRoute}
          routeSegments={privacySegments}
          mapProvider={{ type: 'osm' }}
        />
      )

      await waitFor(() => {
        expect(handlers.has(`click:${MAP_ROUTE_HIDDEN_HIT_LAYER_ID}`)).toBe(
          true
        )
      })

      await act(async () => {
        handlers.get(`click:${MAP_ROUTE_HIDDEN_HIT_LAYER_ID}`)?.({
          point: { x: 30, y: 40 }
        })
      })

      expect(screen.getByTestId('route-privacy-hint')).toBeInTheDocument()

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 4100))
      })

      expect(screen.queryByTestId('route-privacy-hint')).not.toBeInTheDocument()
    })

    it('leaves clicked hint up on hover-capable devices', async () => {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => ({ matches: true, media: query })
      })

      try {
        const { handlers } = setupGlMock()

        render(
          <ActivityMapPanel
            routeSamples={sampleRoute}
            routeSegments={privacySegments}
            mapProvider={{ type: 'osm' }}
          />
        )

        await waitFor(() => {
          expect(handlers.has(`click:${MAP_ROUTE_HIDDEN_HIT_LAYER_ID}`)).toBe(
            true
          )
        })

        await act(async () => {
          handlers.get(`click:${MAP_ROUTE_HIDDEN_HIT_LAYER_ID}`)?.({
            point: { x: 25, y: 35 }
          })
        })

        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 4100))
        })

        expect(screen.getByTestId('route-privacy-hint')).toBeInTheDocument()
      } finally {
        Reflect.deleteProperty(window, 'matchMedia')
      }
    })
  })

  describe('provider failure & timeout handling', () => {
    it('falls back to static preview when GL module loading fails', async () => {
      vi.mocked(loadMaplibreModule).mockRejectedValue(
        new Error('Network error loading maplibre')
      )

      render(
        <ActivityMapPanel
          mapAttachment={sampleAttachment}
          routeSamples={sampleRoute}
          mapProvider={{ type: 'osm' }}
        />
      )

      expect(
        await screen.findByText(
          'Interactive map unavailable. Using static preview.'
        )
      ).toBeInTheDocument()
      expect(screen.getByTestId('media-attachment')).toBeInTheDocument()
    })

    it('falls back to static preview when GL map load times out (watchdog)', async () => {
      vi.useFakeTimers()
      try {
        const { map } = setupGlMock(false)

        render(
          <ActivityMapPanel
            mapAttachment={sampleAttachment}
            routeSamples={sampleRoute}
            mapProvider={{ type: 'osm' }}
          />
        )

        await act(async () => {
          vi.advanceTimersByTime(1000)
        })

        expect(
          screen.queryByText(
            'Interactive map unavailable. Using static preview.'
          )
        ).not.toBeInTheDocument()

        await act(async () => {
          vi.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS)
        })

        expect(
          screen.getByText('Interactive map unavailable. Using static preview.')
        ).toBeInTheDocument()
        expect(map.remove).toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('falls back to static preview when MapKit reports unavailable', async () => {
      render(
        <ActivityMapPanel
          mapAttachment={sampleAttachment}
          routeSamples={sampleRoute}
          mapProvider={{ type: 'apple' }}
        />
      )

      expect(screen.getByTestId('mapkit-route-map')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('mapkit-trigger-unavailable'))

      expect(
        screen.getByText('Interactive map unavailable. Using static preview.')
      ).toBeInTheDocument()
      expect(screen.getByTestId('media-attachment')).toBeInTheDocument()
    })
  })

  describe('scrub highlighting changes', () => {
    it('updates active point source on GL map when highlightedElapsedSeconds changes', async () => {
      const { sources } = setupGlMock()

      const { rerender } = render(
        <ActivityMapPanel
          routeSamples={sampleRoute}
          mapProvider={{ type: 'osm' }}
          highlightedElapsedSeconds={null}
        />
      )

      await waitFor(() => {
        expect(sources.has(MAP_ACTIVE_POINT_SOURCE_ID)).toBe(true)
      })

      const activePointSource = sources.get(MAP_ACTIVE_POINT_SOURCE_ID)!

      rerender(
        <ActivityMapPanel
          routeSamples={sampleRoute}
          mapProvider={{ type: 'osm' }}
          highlightedElapsedSeconds={60}
        />
      )

      await waitFor(() => {
        expect(activePointSource.setData).toHaveBeenCalledWith({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {
                isHiddenByPrivacy: false
              },
              geometry: {
                type: 'Point',
                coordinates: [-122.418, 37.7755]
              }
            }
          ]
        })
      })

      rerender(
        <ActivityMapPanel
          routeSamples={sampleRoute}
          mapProvider={{ type: 'osm' }}
          highlightedElapsedSeconds={null}
        />
      )

      await waitFor(() => {
        expect(activePointSource.setData).toHaveBeenLastCalledWith({
          type: 'FeatureCollection',
          features: []
        })
      })
    })
  })

  describe('unmount cleanup', () => {
    it('removes the map instance and cancels timers when unmounted', async () => {
      const { map } = setupGlMock()

      const { unmount } = render(
        <ActivityMapPanel
          routeSamples={sampleRoute}
          mapProvider={{ type: 'osm' }}
        />
      )

      await waitFor(() => {
        expect(map.once).toHaveBeenCalled()
      })

      unmount()

      expect(map.remove).toHaveBeenCalled()
    })

    it('cancels initialization cleanly if unmounted before GL module resolves', async () => {
      let resolveModule: (val: unknown) => void = () => {}
      vi.mocked(loadMaplibreModule).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveModule = resolve
          })
      )

      const { unmount } = render(
        <ActivityMapPanel
          routeSamples={sampleRoute}
          mapProvider={{ type: 'osm' }}
        />
      )

      unmount()

      // Resolving after unmount must not throw or error
      await act(async () => {
        resolveModule({
          Map: vi.fn(),
          LngLatBounds: vi.fn()
        })
      })
    })
  })
})
