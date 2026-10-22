/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import {
  type AnchorHTMLAttributes,
  type ReactElement,
  type ReactNode
} from 'react'

import {
  type DraftRecord,
  resetDraftsChannelForTesting,
  resetDraftsDbForTesting,
  saveDraft,
  setDraftsIndexedDBFactory
} from '@/lib/client/drafts'
import { DraftsProvider } from '@/lib/components/drafts/DraftsProvider'
import { NavPreferencesProvider } from '@/lib/components/layout/nav-preferences-context'
import { Sidebar } from '@/lib/components/layout/sidebar'
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
  usePathname: () => mockPathname()
}))

const mockUpdateNavigationPreferences = vi.fn()
vi.mock('@/lib/client', () => ({
  updateNavigationPreferences: (input: unknown) =>
    mockUpdateNavigationPreferences(input)
}))

vi.mock('@/lib/components/actor-switcher/ActorSwitcher', () => ({
  ActorSwitcher: () => <div data-testid="actor-switcher" />
}))

const renderSidebar = (
  ui: ReactElement,
  preferences: { order?: string[]; hidden?: string[] } = {}
) =>
  render(
    <NavPreferencesProvider
      initialOrder={preferences.order}
      initialHidden={preferences.hidden}
    >
      {ui}
    </NavPreferencesProvider>
  )

const lists = [
  { id: 'a', title: 'Running club' },
  { id: 'b', title: 'Fediverse devs' }
]

describe('Sidebar', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/lists')
  })

  it('expands the Lists group into the user lists by default on a lists route', () => {
    renderSidebar(<Sidebar lists={lists} />)

    const nav = screen.getAllByRole('navigation')[0]
    expect(
      within(nav).getByRole('link', { name: 'Running club' })
    ).toHaveAttribute('href', '/lists/a')
    expect(
      within(nav).getByRole('link', { name: 'Fediverse devs' })
    ).toHaveAttribute('href', '/lists/b')
  })

  it('collapses and re-expands the Lists group on toggle', () => {
    renderSidebar(<Sidebar lists={lists} />)

    const nav = screen.getAllByRole('navigation')[0]
    fireEvent.click(within(nav).getByRole('button', { name: 'Collapse lists' }))
    expect(
      within(nav).queryByRole('link', { name: 'Running club' })
    ).not.toBeInTheDocument()

    fireEvent.click(within(nav).getByRole('button', { name: 'Expand lists' }))
    expect(
      within(nav).getByRole('link', { name: 'Running club' })
    ).toBeInTheDocument()
  })

  it('renders Lists as a plain link when the user has no lists', () => {
    mockPathname.mockReturnValue('/')
    renderSidebar(<Sidebar lists={[]} />)

    const nav = screen.getAllByRole('navigation')[0]
    expect(within(nav).getByRole('link', { name: 'Lists' })).toHaveAttribute(
      'href',
      '/lists'
    )
    // No collapse control without lists to collapse. The customization ⋯
    // button is still there, so this asks about the chevron specifically.
    expect(
      within(nav).queryByRole('button', {
        name: /collapse lists|expand lists/i
      })
    ).not.toBeInTheDocument()
  })

  it('renders user profile link with prefetch disabled', () => {
    mockPathname.mockReturnValue('/')
    renderSidebar(
      <Sidebar
        lists={[]}
        user={{
          handle: '@alice@activities.local',
          username: 'alice',
          name: 'Alice'
        }}
      />
    )

    const profileLinks = screen
      .getAllByRole('link')
      .filter(
        (link) => link.getAttribute('href') === '/@alice@activities.local'
      )
    expect(profileLinks.length).toBeGreaterThan(0)
    for (const link of profileLinks) {
      expect(link).toHaveAttribute('data-prefetch', 'false')
    }
  })

  describe('customization', () => {
    // jsdom has no pointer layout, so the Radix trigger opens from the
    // keyboard (same approach as the settings layout test).
    const openRowMenu = (label: string) => {
      const nav = screen.getAllByRole('navigation')[0]
      fireEvent.keyDown(
        within(nav).getByRole('button', {
          name: `Customize ${label} navigation`
        }),
        { key: 'ArrowDown' }
      )
    }

    // The group starts collapsed unless the route is inside it, so a test that
    // wants to see a hidden row opens it first.
    const openMoreGroup = () => {
      const nav = screen.getAllByRole('navigation')[0]
      fireEvent.click(within(nav).getByRole('button', { name: /More/ }))
    }

    beforeEach(() => {
      mockPathname.mockReturnValue('/')
      mockUpdateNavigationPreferences.mockReset()
      mockUpdateNavigationPreferences.mockResolvedValue(true)
    })

    it('renders no More group until something is hidden', () => {
      renderSidebar(<Sidebar lists={[]} />)

      const nav = screen.getAllByRole('navigation')[0]
      expect(
        within(nav).queryByRole('button', { name: /^More/ })
      ).not.toBeInTheDocument()
    })

    it('hides a row into the More group and saves the choice', async () => {
      renderSidebar(<Sidebar lists={[]} />)

      openRowMenu('Favorites')
      fireEvent.click(
        screen.getByRole('menuitem', { name: 'Hide from navigation' })
      )

      const nav = screen.getAllByRole('navigation')[0]
      expect(
        within(nav).queryByRole('link', { name: 'Favorites' })
      ).not.toBeInTheDocument()

      // Hiding tidies the sidebar; it doesn't put the section out of reach.
      openMoreGroup()
      expect(
        within(nav).getByRole('link', { name: 'Favorites' })
      ).toBeInTheDocument()

      await waitFor(() =>
        expect(mockUpdateNavigationPreferences).toHaveBeenCalledWith(
          expect.objectContaining({ navHidden: ['favorites'] })
        )
      )
    })

    it('puts a hidden item back from the More group', async () => {
      renderSidebar(<Sidebar lists={[]} />)

      openRowMenu('Favorites')
      fireEvent.click(
        screen.getByRole('menuitem', { name: 'Hide from navigation' })
      )

      openMoreGroup()
      const nav = screen.getAllByRole('navigation')[0]
      fireEvent.click(
        within(nav).getByRole('button', {
          name: 'Show Favorites in navigation'
        })
      )

      expect(
        within(nav).queryByRole('button', { name: /^More/ })
      ).not.toBeInTheDocument()
      await waitFor(() =>
        expect(mockUpdateNavigationPreferences).toHaveBeenLastCalledWith(
          expect.objectContaining({ navHidden: [] })
        )
      )
    })

    it('follows a hidden item to the More group that now holds it', () => {
      renderSidebar(<Sidebar lists={[]} />)

      openRowMenu('Explore')
      fireEvent.click(
        screen.getByRole('menuitem', { name: 'Hide from navigation' })
      )

      // Hiding takes the ⋯ that did it out of the navigation, so the menu's own
      // restore would leave focus on a detached node — and the user on <body>,
      // tabbing from the top of the document for every item they tidy away.
      const nav = screen.getAllByRole('navigation')[0]
      expect(document.activeElement).toBe(
        within(nav).getByRole('button', { name: /^More/ })
      )
    })

    it('follows a hidden item into the More group when it is already open', () => {
      renderSidebar(<Sidebar lists={[]} />, { hidden: ['favorites'] })

      openMoreGroup()
      openRowMenu('Explore')
      fireEvent.click(
        screen.getByRole('menuitem', { name: 'Hide from navigation' })
      )

      const nav = screen.getAllByRole('navigation')[0]
      expect(document.activeElement).toBe(
        within(nav).getByRole('link', { name: 'Explore' })
      )
    })

    it('follows a restored item to its place in the navigation', () => {
      renderSidebar(<Sidebar lists={[]} />, {
        hidden: ['favorites', 'bookmarks']
      })

      openMoreGroup()
      const nav = screen.getAllByRole('navigation')[0]
      fireEvent.click(
        within(nav).getByRole('button', {
          name: 'Show Favorites in navigation'
        })
      )

      // Restoring unmounts the button that did it, and a browser hands focus
      // back to the body when that happens — so without this, putting three
      // items back means tabbing down the whole sidebar three times.
      expect(document.activeElement).toBe(
        within(nav).getByRole('link', { name: 'Favorites' })
      )
    })

    it('offers no hide option on a pinned row', () => {
      renderSidebar(<Sidebar lists={[]} />)

      openRowMenu('Settings')

      expect(
        screen.getByRole('menuitem', { name: 'Always shown' })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('menuitem', { name: 'Hide from navigation' })
      ).not.toBeInTheDocument()
    })

    it('moves a row up and saves the new order', async () => {
      renderSidebar(<Sidebar lists={[]} />)

      openRowMenu('Search')
      fireEvent.click(screen.getByRole('menuitem', { name: 'Move up' }))

      await waitFor(() =>
        expect(mockUpdateNavigationPreferences).toHaveBeenCalledWith(
          expect.objectContaining({
            navOrder: expect.arrayContaining(['search', 'timeline'])
          })
        )
      )
      const [{ navOrder }] = mockUpdateNavigationPreferences.mock.calls[0]
      expect(navOrder.slice(0, 2)).toEqual(['search', 'timeline'])
    })

    // The rail (md–xl) has no room for per-row menus, so hidden items live in a
    // flyout off its own More button. Every control in there has to be a real
    // menu item: Radix swallows Tab inside a menu and only moves focus between
    // the items it knows about, so anything else is unreachable.
    it('offers each hidden item and its own restore control in the rail flyout', async () => {
      renderSidebar(<Sidebar lists={[]} />, { hidden: ['favorites'] })

      const rail = screen.getAllByRole('navigation')[1]
      fireEvent.keyDown(
        within(rail).getByRole('button', { name: 'More navigation' }),
        { key: 'ArrowDown' }
      )

      const items = await screen.findAllByRole('menuitem')
      expect(
        items.map((item) => item.getAttribute('aria-label') ?? item.textContent)
      ).toEqual(['Favorites', 'Show Favorites in navigation'])
    })

    it('restores from the rail flyout without closing it', async () => {
      renderSidebar(<Sidebar lists={[]} />, {
        hidden: ['favorites', 'bookmarks']
      })

      const rail = screen.getAllByRole('navigation')[1]
      fireEvent.keyDown(
        within(rail).getByRole('button', { name: 'More navigation' }),
        { key: 'ArrowDown' }
      )
      fireEvent.click(
        await screen.findByRole('menuitem', {
          name: 'Show Favorites in navigation'
        })
      )

      // Left open so several items can be put back in one visit.
      expect(
        await screen.findByRole('menuitem', {
          name: 'Show Bookmarks in navigation'
        })
      ).toBeInTheDocument()
      await waitFor(() =>
        expect(mockUpdateNavigationPreferences).toHaveBeenLastCalledWith(
          expect.objectContaining({ navHidden: ['bookmarks'] })
        )
      )
    })

    it('follows the last item out of the rail flyout, which closes with it', async () => {
      // Focusing a rail link opens its Radix tooltip, which measures itself.
      const originalResizeObserver = global.ResizeObserver
      global.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver

      renderSidebar(<Sidebar lists={[]} />, { hidden: ['favorites'] })

      const rail = screen.getAllByRole('navigation')[1]
      fireEvent.keyDown(
        within(rail).getByRole('button', { name: 'More navigation' }),
        { key: 'ArrowDown' }
      )
      fireEvent.click(
        await screen.findByRole('menuitem', {
          name: 'Show Favorites in navigation'
        })
      )

      // Restoring the only hidden item takes the flyout, and the trigger it
      // hangs off, out of the rail — so focus has nowhere to return to unless
      // it follows the item to the rail button it just became.
      await waitFor(() =>
        expect(document.activeElement).toBe(
          within(rail).getByRole('link', { name: 'Favorites' })
        )
      )

      global.ResizeObserver = originalResizeObserver
    })

    it('marks only the open list as the current page, not its section', () => {
      mockPathname.mockReturnValue('/lists/a')
      renderSidebar(<Sidebar lists={lists} />)

      const nav = screen.getAllByRole('navigation')[0]
      expect(
        within(nav).getByRole('link', { name: 'Running club' })
      ).toHaveAttribute('aria-current', 'page')
      // Two links claiming the current page reads it out twice.
      expect(
        within(nav).getByRole('link', { name: 'Lists' })
      ).not.toHaveAttribute('aria-current')
    })

    it('marks the current page for assistive technology', () => {
      mockPathname.mockReturnValue('/search')
      renderSidebar(<Sidebar lists={[]} />)

      const nav = screen.getAllByRole('navigation')[0]
      expect(within(nav).getByRole('link', { name: 'Search' })).toHaveAttribute(
        'aria-current',
        'page'
      )
      expect(
        within(nav).getByRole('link', { name: 'Timeline' })
      ).not.toHaveAttribute('aria-current')
    })

    // `text-primary-text`, never `text-primary`: `--primary` is the icon orange
    // and is under the AA floor as a label (globals.contrast.test.ts guards the
    // token values, not their usage).
    it('draws only the current row label in the AA-safe text token', () => {
      mockPathname.mockReturnValue('/search')
      renderSidebar(<Sidebar lists={[]} />)

      const nav = screen.getAllByRole('navigation')[0]
      const active = within(nav).getByRole('link', { name: 'Search' })
      expect(active).toHaveClass('text-primary-text')
      expect(active).not.toHaveClass('text-primary')
      expect(
        within(nav).getByRole('link', { name: 'Timeline' })
      ).not.toHaveClass('text-primary-text')
    })

    it('shows the current page on the collapsed More row', () => {
      mockPathname.mockReturnValue('/favorites')
      renderSidebar(<Sidebar lists={[]} />, { hidden: ['favorites'] })

      const nav = screen.getAllByRole('navigation')[0]
      const more = within(nav).getByRole('button', { name: /^More/ })
      expect(more).not.toHaveClass('text-primary-text')
      fireEvent.click(more)
      expect(more).toHaveClass('text-primary-text')
    })

    it('marks the current row of the rail flyout as the current page', async () => {
      mockPathname.mockReturnValue('/favorites')
      renderSidebar(<Sidebar lists={[]} />, { hidden: ['favorites'] })

      const rail = screen.getAllByRole('navigation')[1]
      fireEvent.keyDown(
        within(rail).getByRole('button', { name: 'More navigation' }),
        { key: 'ArrowDown' }
      )

      expect(
        await screen.findByRole('menuitem', { name: 'Favorites' })
      ).toHaveAttribute('aria-current', 'page')
    })

    it('opens the More group on its own for a route inside it', () => {
      mockPathname.mockReturnValue('/favorites')
      renderSidebar(<Sidebar lists={[]} />, { hidden: ['favorites'] })

      // The group opens on its own when the route is inside it.
      const nav = screen.getAllByRole('navigation')[0]
      expect(
        within(nav).getByRole('link', { name: 'Favorites' })
      ).toBeInTheDocument()
    })

    it('toggles the More group open and closed from its button', () => {
      mockPathname.mockReturnValue('/favorites')
      renderSidebar(<Sidebar lists={[]} />, { hidden: ['favorites'] })

      const nav = screen.getAllByRole('navigation')[0]
      const more = within(nav).getByRole('button', { name: /^More/ })
      // Open on its own because the route is inside the group.
      expect(more).toHaveAttribute('aria-expanded', 'true')
      fireEvent.click(more)
      expect(more).toHaveAttribute('aria-expanded', 'false')
    })

    it('cannot move the first row up or the last row down', () => {
      renderSidebar(<Sidebar lists={[]} />)

      openRowMenu('Timeline')
      expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    })
  })

  describe('pinned account', () => {
    const user = {
      handle: '@testuser@example.com',
      name: 'Test User',
      username: 'testuser'
    }

    it('sizes both sidebars to the dynamic viewport so Safari toolbars never cover the account', () => {
      const { container } = renderSidebar(<Sidebar lists={[]} user={user} />)

      const asides = container.querySelectorAll('aside')
      expect(asides).toHaveLength(2)
      for (const aside of asides) {
        expect(aside).toHaveClass('h-dvh')
        expect(aside).not.toHaveClass('h-screen')
      }
    })

    it('keeps the account rows clear of the home indicator', () => {
      const { container } = renderSidebar(<Sidebar lists={[]} user={user} />)

      const accountRows = Array.from(
        container.querySelectorAll(`aside a[href="/${user.handle}"]`)
      ).map((link) => link.closest('aside > div'))
      expect(accountRows).toHaveLength(2)
      for (const row of accountRows) {
        expect(row?.className).toContain('env(safe-area-inset-bottom,0px)')
      }
    })

    it('leaves the bottom inset to the drawer panel in the drawer', () => {
      const { container } = renderSidebar(
        <Sidebar variant="drawer" lists={[]} user={user} />
      )

      const row = container
        .querySelector(`aside a[href="/${user.handle}"]`)
        ?.closest('aside > div')
      expect(row).toHaveClass('pb-4')
      expect(row?.className).not.toContain('safe-area-inset-bottom')
    })
  })

  describe('drawer variant', () => {
    it('omits the tablet rail when variant is drawer', () => {
      renderSidebar(<Sidebar variant="drawer" lists={[]} />)

      // Responsive mode renders 2 navigation landmarks (desktop + tablet rail),
      // while drawer mode renders only 1.
      expect(screen.getAllByRole('navigation')).toHaveLength(1)
    })

    it('fires onNavigate when clicking navigation links', () => {
      const onNavigate = vi.fn()
      renderSidebar(
        <Sidebar variant="drawer" lists={[]} onNavigate={onNavigate} />
      )

      fireEvent.click(screen.getByRole('link', { name: 'Timeline' }))
      expect(onNavigate).toHaveBeenCalledTimes(1)
    })

    it('retains the unread notification badge on the Notifications item with accessible text', () => {
      renderSidebar(<Sidebar variant="drawer" lists={[]} unreadCount={7} />)

      expect(screen.getByText('7')).toBeInTheDocument()
      expect(screen.getByText('(7 unread)')).toBeInTheDocument()
    })

    it('gives drawer navigation links a 44px minimum touch target', () => {
      renderSidebar(<Sidebar variant="drawer" lists={[]} />)

      expect(screen.getByRole('link', { name: 'Timeline' })).toHaveClass(
        'min-h-[44px]'
      )
    })

    it('marks Timeline item as active when pathname is / or /app', () => {
      mockPathname.mockReturnValue('/')
      const { unmount } = renderSidebar(<Sidebar lists={[]} />)
      expect(
        screen.getAllByRole('link', { name: 'Timeline' })[0]
      ).toHaveAttribute('aria-current', 'page')
      unmount()

      mockPathname.mockReturnValue('/app')
      renderSidebar(<Sidebar lists={[]} />)
      expect(
        screen.getAllByRole('link', { name: 'Timeline' })[0]
      ).toHaveAttribute('aria-current', 'page')
    })

    it('renders skeleton account footer when isLoading is true and no user is provided', () => {
      const { container } = renderSidebar(<Sidebar lists={[]} isLoading />)

      const skeletonElements = container.querySelectorAll('.skeleton')
      expect(skeletonElements.length).toBeGreaterThan(0)
    })

    it('renders user account row instead of skeleton when user is provided even if isLoading is true', () => {
      const { container } = renderSidebar(
        <Sidebar
          lists={[]}
          isLoading
          user={{
            name: 'Alice',
            username: 'alice',
            handle: '@alice@example.com'
          }}
        />
      )

      expect(screen.getAllByText('Alice')[0]).toBeInTheDocument()
      expect(container.querySelectorAll('.skeleton')).toHaveLength(0)
    })
  })

  describe('tapping the page already open', () => {
    const scrollTo = vi.fn()
    // Runs after React's root listener, so it records what the sidebar's
    // handler decided, then stops jsdom from following the href.
    let preventedBySidebar: boolean | undefined
    const stopDocumentNavigation = (event: Event) => {
      preventedBySidebar = event.defaultPrevented
      event.preventDefault()
    }
    let originalScrollTo: typeof window.scrollTo

    beforeEach(() => {
      originalScrollTo = window.scrollTo
      preventedBySidebar = undefined
      scrollTo.mockClear()
      window.scrollTo = scrollTo
    })

    afterEach(() => {
      window.scrollTo = originalScrollTo
      window.history.replaceState(null, '', '/')
      document.removeEventListener('click', stopDocumentNavigation)
    })

    it('scrolls the open page back to the top instead of following the link', () => {
      mockPathname.mockReturnValue('/')
      const onNavigate = vi.fn()
      const onStay = vi.fn()
      renderSidebar(
        <Sidebar lists={[]} onNavigate={onNavigate} onStay={onStay} />
      )

      const nav = screen.getAllByRole('navigation')[0]
      const timeline = within(nav).getByRole('link', { name: 'Timeline' })
      const click = createEvent.click(timeline, { button: 0 })
      fireEvent(timeline, click)

      expect(click.defaultPrevented).toBe(true)
      // The drawer closes without treating it as a page change, and scrolls
      // once it has released the page.
      expect(onNavigate).not.toHaveBeenCalled()
      expect(onStay).toHaveBeenCalledTimes(1)
      expect(scrollTo).not.toHaveBeenCalled()
      onStay.mock.calls[0][0]()
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    })

    it('scrolls straight away outside the drawer', () => {
      mockPathname.mockReturnValue('/')
      renderSidebar(<Sidebar lists={[]} />)

      const nav = screen.getAllByRole('navigation')[0]
      const timeline = within(nav).getByRole('link', { name: 'Timeline' })
      fireEvent.click(timeline, { button: 0 })

      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    })

    it.each([
      { case: 'another page', pathname: '/search', search: '', metaKey: false },
      {
        case: 'the open page with a query, which resets it',
        pathname: '/',
        search: '?type=mentions',
        metaKey: false
      },
      {
        case: 'a modified click, for a new tab',
        pathname: '/',
        search: '',
        metaKey: true
      }
    ])('follows the link for $case', ({ pathname, search, metaKey }) => {
      mockPathname.mockReturnValue(pathname)
      window.history.replaceState(null, '', `${pathname}${search}`)
      renderSidebar(<Sidebar lists={[]} />)

      const nav = screen.getAllByRole('navigation')[0]
      const timeline = within(nav).getByRole('link', { name: 'Timeline' })
      const click = createEvent.click(timeline, { button: 0, metaKey })
      document.addEventListener('click', stopDocumentNavigation)
      fireEvent(timeline, click)

      expect(preventedBySidebar).toBe(false)
      expect(scrollTo).not.toHaveBeenCalled()
    })
  })

  describe('Drafts item', () => {
    const draft = (id: string): DraftRecord => ({
      id,
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
    })

    const renderWithDrafts = async (
      ui: ReactElement,
      saved: number,
      provided = true
    ) => {
      for (let i = 0; i < saved; i++) {
        await saveDraft(draft(`d${i}`), { expectedRevision: 0, epoch: 0 })
      }
      return renderSidebar(
        provided ? (
          <DraftsProvider accountId="account-1" actorId="actor-1">
            {ui}
          </DraftsProvider>
        ) : (
          ui
        )
      )
    }

    beforeEach(() => {
      installFakeBroadcastChannel()
      setDraftsIndexedDBFactory(new IDBFactory())
    })

    afterEach(() => {
      resetDraftsChannelForTesting()
      setDraftsIndexedDBFactory(null)
      resetDraftsDbForTesting()
      vi.unstubAllGlobals()
    })

    it('links to /drafts after Messages, with no badge at 0', async () => {
      await renderWithDrafts(<Sidebar lists={[]} />, 0)

      const nav = screen.getAllByRole('navigation')[0]
      const names = within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent)
      expect(names.indexOf('Drafts')).toBe(names.indexOf('Messages') + 1)
      expect(within(nav).getByRole('link', { name: 'Drafts' })).toHaveAttribute(
        'href',
        '/drafts'
      )
    })

    it('shows a gray count badge with sr-only text in the full sidebar', async () => {
      await renderWithDrafts(<Sidebar lists={[]} />, 3)

      const nav = screen.getAllByRole('navigation')[0]
      const link = await within(nav).findByRole('link', {
        name: /Drafts\s*\(3 unsent\)/
      })
      const badge = within(link).getByText('3')
      expect(badge).toHaveAttribute('data-tone', 'gray')
      expect(badge).toHaveAttribute('aria-hidden', 'true')
      expect(within(link).getByText('(3 unsent)')).toHaveClass('sr-only')
    })

    it('shows the badge in the phone drawer', async () => {
      await renderWithDrafts(<Sidebar variant="drawer" lists={[]} />, 2)

      const link = await screen.findByRole('link', {
        name: /Drafts\s*\(2 unsent\)/
      })
      expect(within(link).getByText('2')).toHaveAttribute('data-tone', 'gray')
    })

    it('overlays the badge on the tablet rail icon and names it on the link', async () => {
      await renderWithDrafts(<Sidebar lists={[]} />, 4)

      const rail = screen.getAllByRole('navigation')[1]
      const link = await within(rail).findByRole('link', {
        name: 'Drafts (4 unsent)'
      })
      const badge = within(link).getByText('4')
      expect(badge).toHaveAttribute('data-tone', 'gray')
      expect(badge).toHaveClass('absolute', '-top-1', '-right-1')
      // A solid fill with real contrast on the light rail, not bg-muted.
      expect(badge).toHaveClass(
        'bg-muted-foreground',
        'text-background',
        'dark:bg-muted-foreground',
        'dark:text-background'
      )
      expect(badge).not.toHaveClass('bg-muted')
      expect(badge).not.toHaveClass('dark:bg-[#383838]')
    })

    it('caps the count at 99+', async () => {
      await renderWithDrafts(<Sidebar variant="drawer" lists={[]} />, 100)

      expect(await screen.findByText('99+')).toBeInTheDocument()
    })

    it('shows no badge outside a DraftsProvider', async () => {
      await renderWithDrafts(<Sidebar variant="drawer" lists={[]} />, 2, false)

      const link = screen.getByRole('link', { name: 'Drafts' })
      expect(within(link).queryByText('2')).not.toBeInTheDocument()
    })
  })
})
