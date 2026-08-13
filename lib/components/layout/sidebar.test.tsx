/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { ReactElement } from 'react'

import { NavPreferencesProvider } from '@/lib/components/layout/nav-preferences-context'
import { Sidebar } from '@/lib/components/layout/sidebar'

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

    it('cannot move the first row up or the last row down', () => {
      renderSidebar(<Sidebar lists={[]} />)

      openRowMenu('Timeline')
      expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    })
  })
})
