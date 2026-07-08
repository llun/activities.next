/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

import { loadMapKitModule } from '@/lib/utils/mapkit'

import { PrivacyZoneMapKit } from './PrivacyZoneMapKit'

// MapKit is a browser-only CDN script that never loads in jsdom, so the loader is
// stubbed with a never-resolving promise by default.
vi.mock('@/lib/utils/mapkit', () => ({
  loadMapKitModule: vi.fn(() => new Promise(() => {}))
}))

const mockLoadMapKitModule = loadMapKitModule as jest.MockedFunction<
  typeof loadMapKitModule
>

describe('PrivacyZoneMapKit', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows the loading overlay while MapKit is still loading', () => {
    render(
      <PrivacyZoneMapKit
        marker={null}
        zones={[]}
        onPick={vi.fn()}
        onUnavailable={vi.fn()}
      />
    )

    expect(screen.getByText(/Loading map/i)).toBeInTheDocument()
    expect(
      screen.getByLabelText('Privacy location picker map')
    ).toBeInTheDocument()
    expect(screen.queryByText('Apple Maps')).not.toBeInTheDocument()
  })

  it('does not report ready while MapKit is still loading', () => {
    const onReady = vi.fn()

    render(
      <PrivacyZoneMapKit
        marker={{ latitude: 52.1, longitude: 5.3 }}
        zones={[{ latitude: 52.1, longitude: 5.3, hideRadiusMeters: 500 }]}
        onPick={vi.fn()}
        onReady={onReady}
        onUnavailable={vi.fn()}
      />
    )

    expect(onReady).not.toHaveBeenCalled()
  })

  it('calls onUnavailable when the MapKit module fails to load', async () => {
    mockLoadMapKitModule.mockReturnValueOnce(
      Promise.reject(new Error('boom')) as never
    )
    const onUnavailable = vi.fn()

    render(
      <PrivacyZoneMapKit
        marker={null}
        zones={[]}
        onPick={vi.fn()}
        onUnavailable={onUnavailable}
      />
    )

    await waitFor(() => expect(onUnavailable).toHaveBeenCalled())
  })
})
