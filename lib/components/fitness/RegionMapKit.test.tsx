/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

import { loadMapKitModule } from '@/lib/utils/mapkit'

import { RegionMapKit } from './RegionMapKit'

// MapKit is a browser-only CDN script that never loads in jsdom, so the loader is
// stubbed with a never-resolving promise by default — the picker must stay in its
// loading state without throwing.
vi.mock('@/lib/utils/mapkit', () => ({
  loadMapKitModule: vi.fn(() => new Promise(() => {}))
}))

const mockLoadMapKitModule = loadMapKitModule as jest.MockedFunction<
  typeof loadMapKitModule
>

const DEFAULT_BOX = {
  nw: { lat: 53, lng: 3 },
  se: { lat: 50, lng: 7 }
}

const renderRegionMapKit = (
  overrides: Partial<Parameters<typeof RegionMapKit>[0]> = {}
) => {
  const onChange = vi.fn()
  const onUnavailable = vi.fn()
  const utils = render(
    <RegionMapKit
      box={DEFAULT_BOX}
      onChange={onChange}
      centerOnUser={false}
      onUnavailable={onUnavailable}
      {...overrides}
    />
  )
  return { onChange, onUnavailable, ...utils }
}

describe('RegionMapKit', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows a loading state until MapKit resolves', () => {
    renderRegionMapKit()

    expect(screen.getByText(/Loading map/i)).toBeInTheDocument()
    // The draw controls and provider badge only render once the map is ready.
    expect(screen.queryByRole('button', { name: /Draw/i })).toBeNull()
    expect(screen.queryByText('Apple Maps')).not.toBeInTheDocument()
  })

  it('calls onUnavailable when the MapKit module fails to load', async () => {
    mockLoadMapKitModule.mockReturnValueOnce(
      Promise.reject(new Error('boom')) as never
    )

    const { onUnavailable } = renderRegionMapKit()

    await waitFor(() => expect(onUnavailable).toHaveBeenCalled())
  })
})
