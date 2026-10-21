/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'

import {
  getConnectionSnapshot,
  probeNow,
  resetConnectionForTesting
} from '@/lib/client/connection'
import { checkServerHealth } from '@/lib/client/health'

import {
  ConnectionAnnouncer,
  ConnectionStatusBar,
  ConnectionStatusStrip
} from './ConnectionStatus'

vi.mock('@/lib/client/health', () => ({ checkServerHealth: vi.fn() }))

const mockHealth = vi.mocked(checkServerHealth)

describe('ConnectionAnnouncer', () => {
  beforeEach(() => {
    resetConnectionForTesting()
    mockHealth.mockReset()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  })

  afterEach(() => {
    resetConnectionForTesting()
    vi.restoreAllMocks()
  })

  it('is always in the DOM as one polite, atomic live region, empty while online', () => {
    render(<ConnectionAnnouncer />)

    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveAttribute('aria-atomic', 'true')
    expect(region).toHaveClass('sr-only')
    expect(region).toBeEmptyDOMElement()
  })

  it('holds only the title when the server cannot be reached, never the countdown', async () => {
    mockHealth.mockResolvedValue(false)
    render(<ConnectionAnnouncer />)

    await act(async () => {
      await probeNow()
    })

    expect(getConnectionSnapshot().nextProbeAt).not.toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(
      `Can't reach ${window.location.host}.`
    )
    expect(screen.getByRole('status').textContent).not.toMatch(/Trying again/)
  })

  it('says "You\'re offline." when the browser is offline, and empties again on recovery', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    mockHealth.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<ConnectionAnnouncer />)

    await act(async () => {
      await probeNow()
    })
    expect(screen.getByRole('status')).toHaveTextContent("You're offline.")

    mockHealth.mockResolvedValue(true)
    await act(async () => {
      await probeNow()
    })
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})

describe('ConnectionStatusBar and ConnectionStatusStrip', () => {
  it('are placeholders that render nothing yet', () => {
    const { container } = render(
      <>
        <ConnectionStatusBar />
        <ConnectionStatusStrip />
      </>
    )

    expect(container).toBeEmptyDOMElement()
  })
})
