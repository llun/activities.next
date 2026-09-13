/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { type AnchorHTMLAttributes, ReactElement, type ReactNode } from 'react'

import { MobileNav } from '@/lib/components/layout/mobile-nav'
import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'
import { MobileNavigationTrigger } from '@/lib/components/layout/mobile-navigation-trigger'
import { NavPreferencesProvider } from '@/lib/components/layout/nav-preferences-context'

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    onNavigate,
    onClick,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    prefetch?: boolean | 'auto' | null
    children: ReactNode
    onNavigate?: (e: { preventDefault: () => void }) => void
  }) => (
    <a
      href={href}
      data-prefetch={String(prefetch)}
      onClick={(e) => {
        onNavigate?.({ preventDefault: () => e.preventDefault() })
        onClick?.(e)
      }}
      {...rest}
    >
      {children}
    </a>
  )
}))

const mockPathname = vi.fn(() => '/lists')
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname()
}))

vi.mock('@/lib/client', () => ({
  updateNavigationPreferences: vi.fn().mockResolvedValue(true)
}))

const renderMobileNav = (
  ui: ReactElement,
  {
    unreadCount = 0,
    order,
    hidden
  }: { unreadCount?: number; order?: string[]; hidden?: string[] } = {}
) =>
  render(
    <NavPreferencesProvider initialOrder={order} initialHidden={hidden}>
      <MobileNavigationProvider unreadCount={unreadCount}>
        <MobileNavigationTrigger data-testid="mobile-trigger" />
        {ui}
      </MobileNavigationProvider>
    </NavPreferencesProvider>
  )

describe('MobileNav', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/lists')
  })

  it('renders nothing when used outside MobileNavigationProvider', () => {
    const { container } = render(
      <NavPreferencesProvider>
        <MobileNav />
      </NavPreferencesProvider>
    )
    expect(container.firstChild).toBeNull()
  })

  it('is closed by default and opens when trigger is clicked', () => {
    renderMobileNav(<MobileNav />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('mobile-trigger'))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Navigation' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Close navigation' })
    ).toBeInTheDocument()
  })

  it('renders full navigation items inside the drawer', () => {
    renderMobileNav(<MobileNav fitnessUrl="/fitness" isAdmin />)

    fireEvent.click(screen.getByTestId('mobile-trigger'))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Timeline' })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Notifications' })
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Search' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Explore' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Messages' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Favorites' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Bookmarks' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Fitness' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Admin' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Account' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })

  it('closes the drawer when close button is clicked', () => {
    renderMobileNav(<MobileNav />)

    fireEvent.click(screen.getByTestId('mobile-trigger'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes the drawer when a navigation link is clicked', () => {
    renderMobileNav(<MobileNav />)

    fireEvent.click(screen.getByTestId('mobile-trigger'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: 'Timeline' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders unread count on both trigger and drawer Notifications item', () => {
    renderMobileNav(<MobileNav unreadCount={4} />, { unreadCount: 4 })

    expect(screen.getByTestId('mobile-trigger')).toHaveAttribute(
      'aria-label',
      'Open navigation, 4 unread notifications'
    )

    fireEvent.click(screen.getByTestId('mobile-trigger'))

    // The Notifications link inside the drawer should display badge with 4
    expect(screen.getAllByText('4')).toHaveLength(2) // trigger badge + drawer row badge
  })

  it('renders fallback user profile link when provided', () => {
    const user = {
      name: 'Alice',
      username: 'alice',
      handle: '@alice@example.com',
      avatarUrl: undefined
    }
    renderMobileNav(<MobileNav user={user} />)

    fireEvent.click(screen.getByTestId('mobile-trigger'))

    const profileLink = screen.getByRole('link', { name: /Alice/ })
    expect(profileLink).toHaveAttribute('href', '/@alice@example.com')
  })
})
