/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { useOpenStatusPath } from '@/lib/components/posts/useOpenStatusPath'

import {
  PENDING_NAVIGATION_TIMEOUT_MS,
  PENDING_STATUS_DELAY_MS,
  PendingProfileNavigationProvider,
  PendingProfileOverlay
} from './PendingProfileNavigation'

const mockPathname = vi.fn(() => '/')
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ push: mockPush })
}))

// Stands in for a profile link: like `next/link`, it takes over the click.
const Page = ({ stopPropagation = false }: { stopPropagation?: boolean }) => (
  <PendingProfileNavigationProvider>
    <a
      href="/@alice@example.com"
      onClick={(event) => {
        event.preventDefault()
        if (stopPropagation) event.stopPropagation()
      }}
    >
      Alice
    </a>
    <a href="/notifications" onClick={(event) => event.preventDefault()}>
      Notifications
    </a>
    <PendingProfileOverlay variant="signed-in" />
  </PendingProfileNavigationProvider>
)

const overlay = () => screen.queryByTestId('pending-profile-overlay')

describe('PendingProfileNavigation', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing until a profile link is clicked', () => {
    render(<Page />)

    expect(overlay()).toBeNull()
  })

  it('shows the profile skeleton as soon as a profile link is clicked', () => {
    render(<Page />)

    fireEvent.click(screen.getByText('Alice'))

    expect(overlay()).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading profile')
  })

  it('shows the skeleton even when the link stops the click propagating', () => {
    render(<Page stopPropagation />)

    fireEvent.click(screen.getByText('Alice'))

    expect(overlay()).toBeInTheDocument()
  })

  it('ignores links to other routes', () => {
    render(<Page />)

    fireEvent.click(screen.getByText('Notifications'))

    expect(overlay()).toBeNull()
  })

  it('ignores a click that opens the profile in a new tab', () => {
    render(<Page />)

    fireEvent.click(screen.getByText('Alice'), { metaKey: true })

    expect(overlay()).toBeNull()
  })

  it('hands over to the destination once the pathname changes', () => {
    const { rerender } = render(<Page />)
    fireEvent.click(screen.getByText('Alice'))

    mockPathname.mockReturnValue('/@alice@example.com')
    rerender(<Page />)

    expect(overlay()).toBeNull()
  })

  it('does not come back when Back returns to the page it was clicked on', () => {
    const { rerender } = render(<Page />)
    fireEvent.click(screen.getByText('Alice'))
    mockPathname.mockReturnValue('/@alice@example.com')
    rerender(<Page />)

    mockPathname.mockReturnValue('/')
    rerender(<Page />)

    expect(overlay()).toBeNull()
  })

  it('uncovers the page when the navigation never commits', () => {
    vi.useFakeTimers()
    render(<Page />)
    fireEvent.click(screen.getByText('Alice'))

    act(() => {
      vi.advanceTimersByTime(PENDING_NAVIGATION_TIMEOUT_MS)
    })

    expect(overlay()).toBeNull()
  })

  it('clears when the page is restored from the back/forward cache', () => {
    render(<Page />)
    fireEvent.click(screen.getByText('Alice'))

    act(() => {
      window.dispatchEvent(new Event('pageshow'))
    })

    expect(overlay()).toBeNull()
  })

  it('renders nothing outside the provider', () => {
    render(<PendingProfileOverlay variant="public" />)

    expect(overlay()).toBeNull()
  })
})

const OpenButton = () => {
  const open = useOpenStatusPath()
  return <button onClick={() => open('/@alice@example.com/abc')}>Open</button>
}

const StatusPage = () => (
  <PendingProfileNavigationProvider>
    <OpenButton />
    <a href="/@bob@example.com" onClick={(event) => event.preventDefault()}>
      Bob
    </a>
    <a href="/notifications" onClick={(event) => event.preventDefault()}>
      Notifications
    </a>
    <PendingProfileOverlay variant="signed-in" />
  </PendingProfileNavigationProvider>
)

const statusOverlay = () => screen.queryByTestId('pending-status-overlay')

describe('pending status navigation', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/')
    mockPush.mockClear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pushes the path and holds the skeleton back for the delay', () => {
    render(<StatusPage />)

    fireEvent.click(screen.getByText('Open'))
    expect(mockPush).toHaveBeenCalledWith('/@alice@example.com/abc')
    expect(statusOverlay()).toBeNull()

    act(() => {
      vi.advanceTimersByTime(PENDING_STATUS_DELAY_MS - 1)
    })
    expect(statusOverlay()).toBeNull()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(statusOverlay()).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading post')
  })

  it('never shows the skeleton when the pathname changes within the delay', () => {
    const { rerender } = render(<StatusPage />)
    fireEvent.click(screen.getByText('Open'))
    act(() => {
      vi.advanceTimersByTime(PENDING_STATUS_DELAY_MS - 100)
    })

    mockPathname.mockReturnValue('/@alice@example.com/abc')
    rerender(<StatusPage />)
    act(() => {
      vi.advanceTimersByTime(PENDING_STATUS_DELAY_MS)
    })

    expect(statusOverlay()).toBeNull()
  })

  it('clears the skeleton when the pathname changes', () => {
    const { rerender } = render(<StatusPage />)
    fireEvent.click(screen.getByText('Open'))
    act(() => {
      vi.advanceTimersByTime(PENDING_STATUS_DELAY_MS)
    })
    expect(statusOverlay()).toBeInTheDocument()

    mockPathname.mockReturnValue('/@alice@example.com/abc')
    rerender(<StatusPage />)

    expect(statusOverlay()).toBeNull()
  })

  it('clears the skeleton after the safety timeout', () => {
    render(<StatusPage />)
    fireEvent.click(screen.getByText('Open'))
    act(() => {
      vi.advanceTimersByTime(PENDING_NAVIGATION_TIMEOUT_MS - 1)
    })
    expect(statusOverlay()).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(statusOverlay()).toBeNull()
  })

  it('does not show a skeleton for the current path', () => {
    mockPathname.mockReturnValue('/@alice@example.com/abc')
    render(<StatusPage />)

    fireEvent.click(screen.getByText('Open'))
    act(() => {
      vi.advanceTimersByTime(PENDING_STATUS_DELAY_MS)
    })

    expect(mockPush).toHaveBeenCalledWith('/@alice@example.com/abc')
    expect(statusOverlay()).toBeNull()
  })

  const openAndShow = () => {
    fireEvent.click(screen.getByText('Open'))
    act(() => {
      vi.advanceTimersByTime(PENDING_STATUS_DELAY_MS)
    })
    expect(statusOverlay()).toBeInTheDocument()
  }

  it('clears when a same-tab link is clicked and the pathname stays', () => {
    render(<StatusPage />)
    openAndShow()

    fireEvent.click(screen.getByText('Notifications'))

    expect(statusOverlay()).toBeNull()
  })

  it('clears on popstate', () => {
    render(<StatusPage />)
    openAndShow()

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(statusOverlay()).toBeNull()
  })

  it('clears the pending status on pageshow', () => {
    render(<StatusPage />)
    openAndShow()

    act(() => {
      window.dispatchEvent(new Event('pageshow'))
    })

    expect(statusOverlay()).toBeNull()
  })

  it('keeps the skeleton on a modified click', () => {
    render(<StatusPage />)
    openAndShow()

    fireEvent.click(screen.getByText('Notifications'), { metaKey: true })

    expect(statusOverlay()).toBeInTheDocument()
  })

  it('shows the profile overlay when both are pending', () => {
    render(<StatusPage />)
    openAndShow()

    fireEvent.click(screen.getByText('Bob'))

    expect(screen.queryByTestId('pending-profile-overlay')).toBeInTheDocument()
    expect(statusOverlay()).toBeNull()
  })

  it('hides the shown skeleton again on a second open and restarts the delay', () => {
    render(<StatusPage />)
    openAndShow()

    fireEvent.click(screen.getByText('Open'))
    expect(statusOverlay()).toBeNull()

    act(() => {
      vi.advanceTimersByTime(PENDING_STATUS_DELAY_MS - 1)
    })
    expect(statusOverlay()).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(statusOverlay()).toBeInTheDocument()
  })

  it('falls back to router.push without a provider', () => {
    render(<OpenButton />)

    fireEvent.click(screen.getByText('Open'))

    expect(mockPush).toHaveBeenCalledWith('/@alice@example.com/abc')
  })
})
