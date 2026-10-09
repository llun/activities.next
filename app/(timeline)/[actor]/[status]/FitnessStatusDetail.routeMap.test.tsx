/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'

import type { FitnessRouteDataResponse } from '@/lib/client'
import type { StatusNote } from '@/lib/types/domain/status'
import { loadMaplibreModule } from '@/lib/utils/maplibre'

import {
  buildFitnessFile,
  buildStatus,
  mockGetFitnessFilesByStatus,
  mockGetFitnessRouteData,
  openSectionMenu,
  renderDetail,
  resetFitnessStatusDetailMocks,
  routeData,
  routeDataWithHiddenSegments
} from './FitnessStatusDetail.testUtils'

vi.mock('@/lib/client', () => ({
  getFitnessFilesByStatus: vi.fn(),
  getFitnessGearList: vi.fn(),
  getFitnessRouteData: vi.fn(),
  updateFitnessFileGear: vi.fn()
}))

vi.mock('@/lib/utils/mapbox', () => ({
  loadMapboxModule: vi.fn()
}))

// The keyless GL loader never resolves here, so the interactive map stays in its
// initializing state (no real MapLibre script is injected in jsdom).
vi.mock('@/lib/utils/maplibre', () => ({
  loadMaplibreModule: vi.fn(() => new Promise(() => {})),
  OPENFREEMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/bright',
  OPENFREEMAP_HEATMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/positron'
}))

vi.mock('next/navigation', async () => {
  const { mockPush, mockRefresh } = await import('./FitnessStatusDetail.mocks')
  return { useRouter: () => ({ refresh: mockRefresh, push: mockPush }) }
})

vi.mock('@/lib/utils/getStatusDetailPathClient', () => ({
  getStatusDetailPathClient: vi.fn(
    async (status: { id: string }) => `/@actor/${status.id}`
  )
}))

vi.mock('@/lib/components/posts/actor', () => ({
  ActorAvatar: () => <div data-testid="actor-avatar" />
}))

vi.mock('@/lib/components/posts/media', () => ({
  Media: () => <div data-testid="media" />
}))

// The MapKit surface is the one map path that is a component rather than an
// imperative GL handle, so it is where a test can read back the instant the
// page is asking the map to highlight.
vi.mock('@/lib/components/fitness/ActivityRouteMapKit', async () => ({
  ActivityRouteMapKit: (await import('./FitnessStatusDetail.mocks'))
    .MockActivityRouteMapKit
}))

vi.mock('@/lib/components/posts/post', async () => ({
  Post: (await import('./FitnessStatusDetail.mocks')).MockPost
}))

vi.mock('@/lib/components/posts/status-reply-box', () => ({
  StatusReplyBox: () => <div data-testid="comment-composer" />
}))

// Stubbed for the same reason `BrandedDeviceLink` is: this page only has to
// open the shared composer in the right mode against the right status and put
// it in the right place. What each mode renders is
// `lib/components/posts/inline-status-composer.test.tsx`'s job.
vi.mock('@/lib/components/posts/inline-status-composer', async () => ({
  InlineStatusComposer: (await import('./FitnessStatusDetail.mocks'))
    .MockInlineStatusComposer
}))

vi.mock('@/lib/components/posts/actions/reply-button', () => ({
  ReplyButton: ({ onReply }: { onReply?: () => void }) => (
    <button type="button" onClick={() => onReply?.()}>
      Reply
    </button>
  )
}))

vi.mock('@/lib/components/posts/actions/repost-button', () => ({
  RepostButton: () => <button type="button">Boost</button>
}))

vi.mock('@/lib/components/posts/actions/like-button', () => ({
  LikeButton: () => <button type="button">Like</button>
}))

vi.mock('@/lib/components/posts/actions/bookmark-button', () => ({
  BookmarkButton: () => <button type="button">Bookmark</button>
}))

// Flattened rather than driven as a real Radix menu; see MockPostMenu.
vi.mock('@/lib/components/posts/actions/post-menu', async () => ({
  PostMenu: (await import('./FitnessStatusDetail.mocks')).MockPostMenu
}))

// Stubbed rather than rendered: this page only has to forward the right props
// to it. Where each of the three renderings actually goes is asserted in
// `lib/components/posts/BrandedDeviceLink.test.tsx`.
vi.mock('@/lib/components/posts/BrandedDeviceLink', async () => ({
  BrandedDeviceLink: (await import('./FitnessStatusDetail.mocks'))
    .MockBrandedDeviceLink
}))

describe('FitnessStatusDetail', () => {
  beforeEach(() => {
    resetFitnessStatusDetailMocks()
  })

  describe('route privacy hint', () => {
    // A GL map stub that actually runs its `load` callback, so the layers and
    // the layer-scoped handlers are really registered, and that records every
    // handler so a test can drive a hover without a browser.
    const renderWithGlMap = async (
      routeData: FitnessRouteDataResponse = routeDataWithHiddenSegments
    ) => {
      const handlers = new Map<
        string,
        (event: { point: { x: number; y: number } }) => void
      >()
      const layers: string[] = []
      const canvas = document.createElement('canvas')
      const map = {
        addSource: vi.fn(),
        addLayer: vi.fn((layer: { id: string }) => {
          layers.push(layer.id)
        }),
        once: vi.fn((event: string, listener: () => void) => {
          if (event === 'load') listener()
        }),
        on: vi.fn(
          (
            event: string,
            layerId: string,
            listener: (payload: { point: { x: number; y: number } }) => void
          ) => {
            // Registration order matters: MapLibre silently drops a listener
            // whose layer does not exist yet, so record what existed at the
            // time rather than only the pairing.
            expect(layers).toContain(layerId)
            handlers.set(`${event}:${layerId}`, listener)
          }
        ),
        getCanvas: vi.fn(() => canvas),
        getSource: vi.fn(() => ({ setData: vi.fn() })),
        getZoom: vi.fn(() => 12),
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
        extend() {
          return this
        }
      }
      vi.mocked(loadMaplibreModule).mockResolvedValue({
        Map: MapConstructor,
        LngLatBounds: LngLatBoundsStub
      } as never)
      mockGetFitnessRouteData.mockResolvedValue(routeData)

      renderDetail()
      const menu = await openSectionMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Analysis' }))
      await waitFor(() => expect(MapConstructor).toHaveBeenCalled())
      await act(async () => {})

      return { map, canvas, handlers, layers }
    }

    const HIT_LAYER = 'activity-route-line-hidden-hit'

    it('adds an invisible wide hit layer over the hidden segments', async () => {
      const { map, layers } = await renderWithGlMap()

      expect(layers).toContain(HIT_LAYER)
      const hitLayer = map.addLayer.mock.calls
        .map(([layer]) => layer as Record<string, unknown>)
        .find((layer) => layer.id === HIT_LAYER) as unknown as {
        filter: unknown
        paint: Record<string, number | string>
      }
      // Zero opacity but a wide stroke: GL's line hit test reads line-width and
      // ignores opacity, so this is hoverable while drawing nothing. The 4px
      // painted line alone would be a ±2px target.
      expect(hitLayer.paint['line-opacity']).toBe(0)
      expect(hitLayer.paint['line-width']).toBeGreaterThan(4)
      expect(hitLayer.filter).toEqual([
        '==',
        ['get', 'isHiddenByPrivacy'],
        true
      ])
    })

    it('shows the hint while the pointer is over a hidden segment', async () => {
      const { canvas, handlers } = await renderWithGlMap()

      expect(screen.queryByTestId('route-privacy-hint')).not.toBeInTheDocument()

      await act(async () => {
        handlers.get(`mousemove:${HIT_LAYER}`)?.({ point: { x: 40, y: 90 } })
      })

      const hint = screen.getByTestId('route-privacy-hint')
      expect(hint).toHaveTextContent('Hidden from other viewers')
      expect(hint).toHaveStyle({ left: '40px', top: '90px' })
      expect(canvas.style.cursor).toBe('help')
    })

    it('hides the hint again when the pointer leaves the segment', async () => {
      const { canvas, handlers } = await renderWithGlMap()

      await act(async () => {
        handlers.get(`mousemove:${HIT_LAYER}`)?.({ point: { x: 40, y: 90 } })
      })
      expect(screen.getByTestId('route-privacy-hint')).toBeInTheDocument()

      await act(async () => {
        handlers.get(`mouseleave:${HIT_LAYER}`)?.({ point: { x: 0, y: 0 } })
      })

      expect(screen.queryByTestId('route-privacy-hint')).not.toBeInTheDocument()
      expect(canvas.style.cursor).toBe('')
    })

    it('explains the hidden segments to assistive technology without a hover', async () => {
      await renderWithGlMap()

      // The hint itself is aria-hidden and unreachable by keyboard, so the
      // explanation is also stated outright whenever the route has green.
      expect(
        screen.getByText(/hidden sections are drawn in green/i)
      ).toBeInTheDocument()
    })

    it('says nothing when no segment is hidden', async () => {
      const { handlers, layers } = await renderWithGlMap(routeData)

      expect(await screen.findByLabelText('Zoom in map')).toBeInTheDocument()
      expect(
        screen.queryByText(/hidden sections are drawn in green/i)
      ).not.toBeInTheDocument()

      // The hit layer filters on `isHiddenByPrivacy`, so with nothing hidden it
      // matches no feature and the handler never fires. Assert that rather than
      // asserting an absence nothing could have produced: firing the handler
      // anyway would only prove the test can skip the filter.
      expect(layers).toContain(HIT_LAYER)
      expect(handlers.has(`mousemove:${HIT_LAYER}`)).toBe(true)
      expect(screen.queryByTestId('route-privacy-hint')).not.toBeInTheDocument()
    })

    it('labels the GL map container the way its MapKit sibling is labelled', async () => {
      await renderWithGlMap()

      // The Apple branch has always carried this; the GL branch was a bare div
      // until the hint made the map's contents worth naming.
      expect(screen.getByLabelText('Activity route map')).toBeInTheDocument()
    })

    it('keeps the hint out of the accessibility tree', async () => {
      const { handlers } = await renderWithGlMap()

      await act(async () => {
        handlers.get(`mousemove:${HIT_LAYER}`)?.({ point: { x: 40, y: 90 } })
      })

      // RoutePrivacyDescription carries the sentence to assistive technology;
      // the chip must not announce it a second time.
      expect(screen.getByTestId('route-privacy-hint')).toHaveAttribute(
        'aria-hidden',
        'true'
      )
    })
  })

  it('renders the route map without a GPS trace badge', async () => {
    mockGetFitnessFilesByStatus.mockResolvedValue([
      buildFitnessFile({ hasMapData: true })
    ])
    renderDetail()
    const menu = await openSectionMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Analysis' }))

    // Positive anchor first: the zoom control lives in the same overlay
    // fragment the badge used to, so its presence proves the overlay really
    // rendered and the badge assertion below is not vacuous.
    expect(await screen.findByLabelText('Zoom in map')).toBeInTheDocument()
    expect(screen.queryByText('GPS trace')).not.toBeInTheDocument()
  })

  it('surfaces an error banner when route data fails to load', async () => {
    mockGetFitnessRouteData.mockRejectedValue(new Error('boom'))

    renderDetail()

    expect(
      await screen.findByText(
        'Could not load route and analysis data for this activity.'
      )
    ).toBeInTheDocument()
  })

  describe('route map failure', () => {
    // This page replaces `Post` for a completed fitness activity, so the retry
    // `Post` offers has to exist here too — otherwise the owner who opens the
    // activity to ask where their map went cannot act on it.
    const mapFailedStatus = () =>
      buildStatus({
        fitness: {
          ...buildStatus().fitness,
          mapFailure: 'missing' as const
        }
      } as Partial<StatusNote>)

    it('offers the owner a retry for a missing route map', () => {
      renderDetail({ status: mapFailedStatus() })

      expect(
        screen.getByText(/route map image could not be generated/i)
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
    })

    it('says nothing to a viewer who is not the owner', () => {
      renderDetail({ status: mapFailedStatus(), currentActor: null })

      expect(
        screen.queryByText(/route map image could not be/i)
      ).not.toBeInTheDocument()
    })

    it('does not offer a retry when the map is fine', () => {
      renderDetail()

      expect(
        screen.queryByText(/route map image could not be/i)
      ).not.toBeInTheDocument()
    })
  })
})
