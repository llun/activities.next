/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen, waitFor } from '@testing-library/react'

import type { FitnessRouteSegment } from '@/lib/client'
import { createMapKitTestDouble } from '@/lib/components/fitness/mapkitTestDouble'
import { loadMapKitModule } from '@/lib/utils/mapkit'

import { ActivityRouteMapKit } from './ActivityRouteMapKit'

// MapKit is a browser-only CDN script that never loads in jsdom, so the loader is
// stubbed with a never-resolving promise by default. Tests that need the post-load
// behaviour resolve it with the in-memory MapKit test double instead.
vi.mock('@/lib/utils/mapkit', () => ({
  loadMapKitModule: vi.fn(() => new Promise(() => {}))
}))

const mockLoadMapKitModule = vi.mocked(loadMapKitModule)

const routeSamples = [
  { lat: 52, lng: 5.6, elapsedSeconds: 0 },
  { lat: 52.6, lng: 6.2, elapsedSeconds: 120 }
]
const routeSegments: FitnessRouteSegment[] = [
  { isHiddenByPrivacy: false, samples: routeSamples }
]

// Fresh array/object identities on every render — exactly what a parent hands the
// component while the user hovers the elapsed-time chart.
const freshSegments = (): FitnessRouteSegment[] => [
  { isHiddenByPrivacy: false, samples: routeSamples.map((s) => ({ ...s })) }
]

describe('ActivityRouteMapKit', () => {
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
    render(
      <ActivityRouteMapKit
        routeSegments={routeSegments}
        routeSamples={routeSamples}
        onUnavailable={vi.fn()}
      />
    )

    expect(screen.getByText(/Loading map/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Activity route map')).toBeInTheDocument()
    // Zoom controls and the badge only render once MapKit is ready.
    expect(screen.queryByRole('button', { name: /Zoom in map/i })).toBeNull()
  })

  it('calls onUnavailable when the MapKit module fails to load', async () => {
    mockLoadMapKitModule.mockReturnValueOnce(
      Promise.reject(new Error('boom')) as never
    )
    const onUnavailable = vi.fn()

    render(
      <ActivityRouteMapKit
        routeSegments={routeSegments}
        routeSamples={routeSamples}
        highlightedElapsedSeconds={60}
        onUnavailable={onUnavailable}
      />
    )

    await waitFor(() => expect(onUnavailable).toHaveBeenCalled())
  })

  it('does not load MapKit when there is no drawable route', () => {
    render(
      <ActivityRouteMapKit
        routeSegments={[]}
        routeSamples={[]}
        onUnavailable={vi.fn()}
      />
    )

    expect(mockLoadMapKitModule).not.toHaveBeenCalled()
  })

  it('draws one polyline overlay per drawable segment once MapKit resolves', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.resolve(double.mapkit)) as never)

    render(
      <ActivityRouteMapKit
        routeSegments={[
          { isHiddenByPrivacy: false, samples: routeSamples },
          { isHiddenByPrivacy: true, samples: routeSamples }
        ]}
        routeSamples={routeSamples}
        onUnavailable={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(double.getMap()?.currentOverlays).toHaveLength(2)
    )
    expect(
      double.overlaysOfKind('polyline').map((overlay) => overlay.styleOptions)
    ).toEqual([
      { strokeColor: '#f97316', lineWidth: 4, strokeOpacity: 0.9 },
      { strokeColor: '#16a34a', lineWidth: 4, strokeOpacity: 0.95 }
    ])
    expect(double.getMap()?.assignedRegions).toHaveLength(1)
  })

  it('does not rebuild the map when only the highlighted elapsed time changes', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.resolve(double.mapkit)) as never)

    const { rerender } = render(
      <ActivityRouteMapKit
        routeSegments={freshSegments()}
        routeSamples={routeSamples.map((sample) => ({ ...sample }))}
        highlightedElapsedSeconds={null}
        onUnavailable={vi.fn()}
      />
    )

    await waitFor(() => expect(double.maps).toHaveLength(1))
    const map = double.getMap()
    await waitFor(() => expect(map?.currentOverlays).toHaveLength(1))

    rerender(
      <ActivityRouteMapKit
        routeSegments={freshSegments()}
        routeSamples={routeSamples.map((sample) => ({ ...sample }))}
        highlightedElapsedSeconds={120}
        onUnavailable={vi.fn()}
      />
    )

    // The highlight marker follows the hover…
    await waitFor(() => expect(map?.currentAnnotations).toHaveLength(1))
    expect(double.annotations[0].coordinate).toEqual({
      latitude: 52.6,
      longitude: 6.2
    })
    // …without tearing the map (or its overlays) down and rebuilding them.
    expect(double.maps).toHaveLength(1)
    expect(map?.destroyCount).toBe(0)
    expect(map?.currentOverlays).toHaveLength(1)
    expect(map?.removedOverlays).toHaveLength(0)
    expect(mockLoadMapKitModule).toHaveBeenCalledTimes(1)
  })

  it('draws the hover highlight as a centred dot rather than a pin', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.resolve(double.mapkit)) as never)
    const markerAnnotation = vi.spyOn(double.mapkit, 'MarkerAnnotation')
    const hiddenSamples = routeSamples.map((sample) => ({
      ...sample,
      isHiddenByPrivacy: true
    }))

    render(
      <ActivityRouteMapKit
        routeSegments={[{ isHiddenByPrivacy: true, samples: hiddenSamples }]}
        routeSamples={hiddenSamples}
        highlightedElapsedSeconds={120}
        onUnavailable={vi.fn()}
      />
    )

    await waitFor(() => expect(double.annotations).toHaveLength(1))
    // Apple's teardrop pin is anchored by its tip, so it covers the map above
    // the sample instead of marking it — the GL surfaces draw a dot on the point.
    expect(markerAnnotation).not.toHaveBeenCalled()

    const element = double.annotations[0].element
    expect(element).not.toBeNull()
    // Zero-sized anchor: MapKit's bottom-centre anchoring lands on its centre.
    expect(element?.style.width).toBe('0px')
    expect(element?.style.height).toBe('0px')

    const [halo, core] = Array.from(element?.children ?? []) as HTMLElement[]
    expect(halo.style.width).toBe('16px')
    expect(halo.style.backgroundColor).toBe('rgb(255, 255, 255)')
    // Green because the hovered sample sits on a privacy-hidden segment.
    expect(core.style.backgroundColor).toBe('rgb(22, 163, 74)')
  })

  it('rebuilds the route overlays when the route data changes', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.resolve(double.mapkit)) as never)

    const { rerender } = render(
      <ActivityRouteMapKit
        routeSegments={routeSegments}
        routeSamples={routeSamples}
        onUnavailable={vi.fn()}
      />
    )
    await waitFor(() =>
      expect(double.getMap()?.currentOverlays).toHaveLength(1)
    )

    const nextSamples = [
      { lat: 40, lng: 1, elapsedSeconds: 0 },
      { lat: 41, lng: 2, elapsedSeconds: 10 },
      { lat: 42, lng: 3, elapsedSeconds: 20 }
    ]
    rerender(
      <ActivityRouteMapKit
        routeSegments={[{ isHiddenByPrivacy: false, samples: nextSamples }]}
        routeSamples={nextSamples}
        onUnavailable={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(double.getMap()?.removedOverlays).toHaveLength(1)
    )
    expect(double.getMap()?.currentOverlays).toHaveLength(1)
    expect(double.overlaysOfKind('polyline')).toHaveLength(2)
    expect(double.maps).toHaveLength(1)
  })
  describe('route privacy hint', () => {
    // jsdom has no PointerEvent, and MouseEvent's pageX/pageY are read-only
    // zeros — mirrors RegionMapKit.test.tsx's helper.
    const pointerEvent = (type: string, pageX: number, pageY: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'pageX', { value: pageX })
      Object.defineProperty(event, 'pageY', { value: pageY })
      return event
    }

    // The test double maps page space straight onto coordinate space
    // (x -> longitude, y -> latitude), so a pointer "on" a sample is just that
    // sample's lng/lat as a page point.
    const hiddenSegments: FitnessRouteSegment[] = [
      { isHiddenByPrivacy: true, samples: routeSamples }
    ]

    const renderWithMapKit = async (segments = hiddenSegments) => {
      const double = createMapKitTestDouble()
      mockLoadMapKitModule.mockImplementation((() =>
        Promise.resolve(double.mapkit)) as never)

      render(
        <ActivityRouteMapKit
          routeSegments={segments}
          routeSamples={routeSamples}
          onUnavailable={vi.fn()}
        />
      )

      await waitFor(() => expect(double.getMap()).not.toBeNull())
      const map = double.getMap()!
      await waitFor(() => expect(map.currentOverlays.length).toBeGreaterThan(0))
      return { double, map }
    }

    it('shows the hint when the pointer is over a hidden segment', async () => {
      const { map } = await renderWithMapKit()

      expect(screen.queryByTestId('route-privacy-hint')).not.toBeInTheDocument()

      await act(async () => {
        map.element.dispatchEvent(pointerEvent('pointermove', 5.6, 52))
      })

      expect(screen.getByTestId('route-privacy-hint')).toHaveTextContent(
        'Hidden from other viewers'
      )
    })

    it('stays silent when the pointer is nowhere near the route', async () => {
      const { map } = await renderWithMapKit()

      await act(async () => {
        map.element.dispatchEvent(pointerEvent('pointermove', 400, 400))
      })

      expect(screen.queryByTestId('route-privacy-hint')).not.toBeInTheDocument()
    })

    it('stays silent when no segment is hidden, even right on the line', async () => {
      const { map } = await renderWithMapKit([
        { isHiddenByPrivacy: false, samples: routeSamples }
      ])

      await act(async () => {
        map.element.dispatchEvent(pointerEvent('pointermove', 5.6, 52))
      })

      expect(screen.queryByTestId('route-privacy-hint')).not.toBeInTheDocument()
    })

    it('hides the hint when the pointer leaves the map', async () => {
      const { map } = await renderWithMapKit()

      await act(async () => {
        map.element.dispatchEvent(pointerEvent('pointermove', 5.6, 52))
      })
      expect(screen.getByTestId('route-privacy-hint')).toBeInTheDocument()

      await act(async () => {
        map.element.dispatchEvent(pointerEvent('pointerleave', 5.6, 52))
      })

      expect(screen.queryByTestId('route-privacy-hint')).not.toBeInTheDocument()
    })

    it('opens the hint on a tap, which MapKit distinguishes from a pan', async () => {
      const { map } = await renderWithMapKit()

      await act(async () => {
        map.emit('single-tap', { pointOnPage: { x: 5.6, y: 52 } })
      })

      expect(screen.getByTestId('route-privacy-hint')).toBeInTheDocument()
    })

    it('ignores a tap that misses the hidden segments', async () => {
      const { map } = await renderWithMapKit()

      await act(async () => {
        map.emit('single-tap', { pointOnPage: { x: 400, y: 400 } })
      })

      expect(screen.queryByTestId('route-privacy-hint')).not.toBeInTheDocument()
    })

    it('anchors the hint at the pointer, in container pixels', async () => {
      const { map } = await renderWithMapKit()
      // The double maps page space onto coordinate space 1:1, and jsdom reports
      // a zero-origin box, so a page point lands unchanged in container pixels.
      map.element.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 300, height: 200 }) as DOMRect

      await act(async () => {
        map.element.dispatchEvent(pointerEvent('pointermove', 5.6, 52))
      })

      // Pre-measurement fallback (jsdom reports a zero-size chip): anchored on
      // the pointer itself rather than clamped.
      expect(screen.getByTestId('route-privacy-hint')).toHaveStyle({
        left: '5.6px',
        top: '52px'
      })
    })

    it('retires a tap-opened hint on a device that cannot hover', async () => {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => ({ matches: false, media: query })
      })
      try {
        const { map } = await renderWithMapKit()

        await act(async () => {
          map.emit('single-tap', { pointOnPage: { x: 5.6, y: 52 } })
        })
        expect(screen.getByTestId('route-privacy-hint')).toBeInTheDocument()

        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 4100))
        })

        expect(
          screen.queryByTestId('route-privacy-hint')
        ).not.toBeInTheDocument()
      } finally {
        Reflect.deleteProperty(window, 'matchMedia')
      }
    })

    it('leaves the hint up on a hover-capable device, where leave governs', async () => {
      // `single-tap` fires for a mouse press too; arming the touch timer there
      // would pull the hint away four seconds into a hover the user is holding.
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => ({ matches: true, media: query })
      })
      try {
        const { map } = await renderWithMapKit()

        await act(async () => {
          map.emit('single-tap', { pointOnPage: { x: 5.6, y: 52 } })
        })

        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 4100))
        })

        expect(screen.getByTestId('route-privacy-hint')).toBeInTheDocument()
      } finally {
        Reflect.deleteProperty(window, 'matchMedia')
      }
    })

    it('clears the hint when the route geometry is replaced under it', async () => {
      const double = createMapKitTestDouble()
      mockLoadMapKitModule.mockImplementation((() =>
        Promise.resolve(double.mapkit)) as never)

      const { rerender } = render(
        <ActivityRouteMapKit
          routeSegments={hiddenSegments}
          routeSamples={routeSamples}
          onUnavailable={vi.fn()}
        />
      )
      await waitFor(() => expect(double.getMap()).not.toBeNull())
      const map = double.getMap()!
      await waitFor(() => expect(map.currentOverlays.length).toBeGreaterThan(0))

      await act(async () => {
        map.element.dispatchEvent(pointerEvent('pointermove', 5.6, 52))
      })
      expect(screen.getByTestId('route-privacy-hint')).toBeInTheDocument()

      // Switching activity file in an aggregated post swaps the polylines under
      // the hint; leaving it up would point at geometry that no longer exists.
      const otherSamples = [
        { lat: 40, lng: -3, elapsedSeconds: 0 },
        { lat: 40.5, lng: -2.5, elapsedSeconds: 120 }
      ]
      rerender(
        <ActivityRouteMapKit
          routeSegments={[{ isHiddenByPrivacy: true, samples: otherSamples }]}
          routeSamples={otherSamples}
          onUnavailable={vi.fn()}
        />
      )

      await waitFor(() =>
        expect(
          screen.queryByTestId('route-privacy-hint')
        ).not.toBeInTheDocument()
      )
    })

    it('detaches its listeners on unmount', async () => {
      const double = createMapKitTestDouble()
      mockLoadMapKitModule.mockImplementation((() =>
        Promise.resolve(double.mapkit)) as never)

      const { unmount } = render(
        <ActivityRouteMapKit
          routeSegments={hiddenSegments}
          routeSamples={routeSamples}
          onUnavailable={vi.fn()}
        />
      )

      await waitFor(() => expect(double.getMap()).not.toBeNull())
      const map = double.getMap()!
      expect(map.listenerCount('single-tap')).toBe(1)
      const removeSpy = vi.spyOn(map.element, 'removeEventListener')

      unmount()

      expect(map.listenerCount('single-tap')).toBe(0)
      expect(removeSpy.mock.calls.map(([type]) => type)).toEqual(
        expect.arrayContaining(['pointermove', 'pointerleave', 'pointercancel'])
      )
    })
  })
})
