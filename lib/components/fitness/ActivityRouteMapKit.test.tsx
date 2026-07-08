/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

import type { FitnessRouteSegment } from '@/lib/client'
import { loadMapKitModule } from '@/lib/utils/mapkit'

import { ActivityRouteMapKit } from './ActivityRouteMapKit'

// MapKit is a browser-only CDN script that never loads in jsdom, so the loader is
// stubbed with a never-resolving promise by default.
vi.mock('@/lib/utils/mapkit', () => ({
  loadMapKitModule: vi.fn(() => new Promise(() => {}))
}))

const mockLoadMapKitModule = loadMapKitModule as jest.MockedFunction<
  typeof loadMapKitModule
>

const routeSamples = [
  { lat: 52, lng: 5.6, elapsedSeconds: 0 },
  { lat: 52.6, lng: 6.2, elapsedSeconds: 120 }
]
const routeSegments: FitnessRouteSegment[] = [
  { isHiddenByPrivacy: false, samples: routeSamples }
]

describe('ActivityRouteMapKit', () => {
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
})
