/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { type AnchorHTMLAttributes, ReactElement, type ReactNode } from 'react'

import {
  resetDraftsChannelForTesting,
  resetDraftsDbForTesting,
  saveDraft,
  setDraftsIndexedDBFactory
} from '@/lib/client/drafts'
import { DraftsProvider } from '@/lib/components/drafts/DraftsProvider'
import { MobileNav } from '@/lib/components/layout/mobile-nav'
import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'
import { MobileNavigationTrigger } from '@/lib/components/layout/mobile-navigation-trigger'
import { NavPreferencesProvider } from '@/lib/components/layout/nav-preferences-context'
import { installFakeBroadcastChannel } from '@/lib/testing/fakeBroadcastChannel'

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    onClick,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    prefetch?: boolean | 'auto' | null
    children: ReactNode
  }) => (
    <a href={href} data-prefetch={String(prefetch)} onClick={onClick} {...rest}>
      {children}
    </a>
  )
}))

const mockPathname = vi.fn(() => '/lists')
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ refresh: vi.fn() })
}))

vi.mock('@/lib/client', () => ({
  updateNavigationPreferences: vi.fn().mockResolvedValue(true)
}))

const renderMobileNav = (
  ui: ReactElement,
  {
    order,
    hidden,
    variant = 'bar'
  }: {
    order?: string[]
    hidden?: string[]
    variant?: 'bar' | 'floating'
  } = {}
) =>
  render(
    <NavPreferencesProvider initialOrder={order} initialHidden={hidden}>
      <MobileNavigationProvider>
        <MobileNavigationTrigger
          data-testid="mobile-trigger"
          variant={variant}
        />
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
      screen.getByRole('heading', { name: 'Navigation drawer' })
    ).toBeInTheDocument()
    const closeButton = screen.getByRole('button', { name: 'Close navigation' })
    expect(closeButton).toBeInTheDocument()
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

  it('shows the unread count on the drawer Notifications row and never on the menu button', () => {
    renderMobileNav(<MobileNav unreadCount={4} />)

    const trigger = screen.getByTestId('mobile-trigger')
    expect(trigger).toHaveAttribute('aria-label', 'Open navigation')
    expect(trigger.textContent).toBe('')

    fireEvent.click(trigger)

    const notifications = screen.getByRole('link', { name: /Notifications/ })
    expect(within(notifications).getByText('4')).toBeInTheDocument()
    expect(screen.getAllByText('4')).toHaveLength(1)
  })

  it('shows the unresolved report count on the drawer Admin row and never on the menu button', () => {
    renderMobileNav(<MobileNav isAdmin openReportCount={3} />)

    const trigger = screen.getByTestId('mobile-trigger')
    expect(trigger.textContent).toBe('')

    fireEvent.click(trigger)

    const admin = screen.getByRole('link', { name: /Admin/ })
    expect(within(admin).getByText('3')).toBeInTheDocument()
    expect(within(admin).getByText('(3 unresolved reports)')).toHaveClass(
      'sr-only'
    )
    expect(screen.getAllByText('3')).toHaveLength(1)
  })

  it('shows the Drafts count on the drawer row and never on the menu button', async () => {
    installFakeBroadcastChannel()
    setDraftsIndexedDBFactory(new IDBFactory())
    try {
      await saveDraft(
        {
          id: 'd1',
          accountId: 'account-1',
          actorId: 'actor-1',
          revision: 0,
          createdAt: 1,
          updatedAt: 1,
          composer: 'post-box',
          text: 'hello',
          contentWarning: '',
          contentWarningVisible: false,
          visibility: 'public',
          quoteApprovalPolicy: 'public',
          attachments: []
        },
        { expectedRevision: 0, epoch: 0 }
      )
      renderMobileNav(
        <DraftsProvider accountId="account-1" actorId="actor-1">
          <MobileNav />
        </DraftsProvider>
      )

      const trigger = screen.getByTestId('mobile-trigger')
      expect(trigger.textContent).toBe('')
      fireEvent.click(trigger)

      const drafts = await screen.findByRole('link', {
        name: /Drafts\s*\(1 unsent\)/
      })
      expect(within(drafts).getByText('1')).toHaveAttribute('data-tone', 'gray')
    } finally {
      resetDraftsChannelForTesting()
      setDraftsIndexedDBFactory(null)
      resetDraftsDbForTesting()
      vi.unstubAllGlobals()
    }
  })

  it.each([
    { variant: 'bar' as const, description: 'the bar menu button' },
    { variant: 'floating' as const, description: 'the floating profile button' }
  ])(
    'returns focus to $description when Escape closes the drawer',
    async ({ variant }) => {
      renderMobileNav(<MobileNav />, { variant })

      const trigger = screen.getByTestId('mobile-trigger')
      trigger.focus()
      fireEvent.click(trigger)
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      // Radix restores focus on a timer after the content unmounts.
      await waitFor(() => expect(trigger).toHaveFocus())
    }
  )

  it('does not return focus to the menu button after a destination is selected', async () => {
    renderMobileNav(<MobileNav />)

    const trigger = screen.getByTestId('mobile-trigger')
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('link', { name: 'Timeline' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Let Radix's focus-restore timer run before asserting it did nothing.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(trigger).not.toHaveFocus()
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

    const profileLink = screen.getByRole('link', { name: 'Profile' })
    expect(profileLink).toHaveAttribute('href', '/@alice@example.com')
  })

  it('marks Timeline as active in drawer when pathname is /app', () => {
    mockPathname.mockReturnValue('/app')
    renderMobileNav(<MobileNav />)

    fireEvent.click(screen.getByTestId('mobile-trigger'))

    const timelineLink = screen.getByRole('link', { name: 'Timeline' })
    expect(timelineLink).toHaveAttribute('aria-current', 'page')
  })
})
