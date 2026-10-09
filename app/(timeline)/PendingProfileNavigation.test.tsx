/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import {
  PENDING_PROFILE_TIMEOUT_MS,
  PendingProfileNavigationProvider,
  PendingProfileOverlay
} from './PendingProfileNavigation'

const mockPathname = vi.fn(() => '/')
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname()
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
      vi.advanceTimersByTime(PENDING_PROFILE_TIMEOUT_MS)
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
