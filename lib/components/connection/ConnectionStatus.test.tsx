/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

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

let mockPathname: string | null = '/notifications'
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname }))

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
  const host = window.location.host

  const goOffline = async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    mockHealth.mockRejectedValue(new TypeError('Failed to fetch'))
    await act(async () => {
      await probeNow()
    })
  }

  const goUnreachable = async () => {
    mockHealth.mockResolvedValue(false)
    await act(async () => {
      await probeNow()
    })
  }

  beforeEach(() => {
    resetConnectionForTesting()
    mockHealth.mockReset()
    mockPathname = '/notifications'
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    resetConnectionForTesting()
    vi.restoreAllMocks()
  })

  it('render nothing while online', () => {
    const { container } = render(
      <>
        <ConnectionStatusBar />
        <ConnectionStatusStrip />
      </>
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('show "You\'re offline." with the WifiOff icon and no Retry', async () => {
    const { container } = render(
      <>
        <ConnectionStatusBar />
        <ConnectionStatusStrip />
      </>
    )
    await goOffline()

    expect(screen.getAllByText("You're offline.")).toHaveLength(2)
    expect(container.querySelectorAll('svg.lucide-wifi-off')).toHaveLength(2)
    expect(container.querySelector('svg.lucide-triangle-alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.queryByText('Showing saved posts')).toBeNull()
  })

  it('add "Showing saved posts" on Home only', async () => {
    mockPathname = '/'
    render(<ConnectionStatusBar />)
    await goOffline()

    expect(screen.getByText('Showing saved posts')).toBeInTheDocument()
  })

  it('show the host, a countdown and Retry with the AlertTriangle icon when unreachable', async () => {
    const { container } = render(
      <>
        <ConnectionStatusBar />
        <ConnectionStatusStrip />
      </>
    )
    await goUnreachable()

    expect(screen.getAllByText(`Can't reach ${host}.`)).toHaveLength(2)
    expect(screen.getAllByText(/Trying again in \d+ s/)).toHaveLength(2)
    expect(
      container.querySelectorAll('svg.lucide-triangle-alert')
    ).toHaveLength(2)
    expect(container.querySelector('svg.lucide-wifi-off')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(2)
  })

  it('Retry probes the server again', async () => {
    render(<ConnectionStatusBar />)
    await goUnreachable()
    mockHealth.mockClear()
    mockHealth.mockResolvedValue(true)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })

    expect(mockHealth).toHaveBeenCalledTimes(1)
    expect(getConnectionSnapshot().state).toBe('online')
  })

  it('keep the countdown out of the accessibility tree and tick it every second', async () => {
    vi.useFakeTimers()
    render(<ConnectionStatusBar />)
    await goUnreachable()

    const countdown = screen.getByText('Trying again in 5 s')
    expect(countdown).toHaveAttribute('aria-hidden', 'true')
    expect(countdown).toHaveClass('tabular-nums')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(screen.getByText('Trying again in 3 s')).toBeInTheDocument()
  })

  it('never add a second live region: only the announcer is a status or alert', async () => {
    render(
      <>
        <ConnectionAnnouncer />
        <ConnectionStatusBar />
        <ConnectionStatusStrip />
      </>
    )
    await goUnreachable()

    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(`Can't reach ${host}.`)
  })

  it('mark the bar desktop-only and the strip phone-only, with the hook for CSS', async () => {
    const { container } = render(
      <>
        <ConnectionStatusBar />
        <ConnectionStatusStrip />
      </>
    )
    await goUnreachable()

    expect(container.querySelector('[data-slot="alert"]')).toHaveClass(
      'max-md:hidden'
    )
    const strip = container.querySelector('[data-connection-strip]')
    expect(strip).toHaveClass('md:hidden', 'sticky', 'bg-info-surface')
  })

  it('publish the strip’s measured height while it shows, and drop it when it goes', async () => {
    let report: () => void = () => undefined
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          report = callback
        }
        observe() {}
        disconnect = disconnect
      }
    )
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      height: 76
    } as DOMRect)
    const root = document.documentElement
    render(<ConnectionStatusStrip />)
    await goUnreachable()

    act(() => report())
    expect(root.style.getPropertyValue('--status-strip-h')).toBe('76px')

    mockHealth.mockResolvedValue(true)
    await act(async () => {
      await probeNow()
    })
    expect(document.querySelector('[data-connection-strip]')).toBeNull()
    expect(disconnect).toHaveBeenCalled()
    expect(root.style.getPropertyValue('--status-strip-h')).toBe('')
    vi.unstubAllGlobals()
  })
})
