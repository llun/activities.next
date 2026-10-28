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
import {
  Activity,
  Ban,
  Files,
  Globe,
  Lock,
  Mail,
  ShieldCheck,
  Sun,
  Trash2,
  User
} from 'lucide-react'
import { usePathname } from 'next/navigation'

import { SectionNavDropdown } from '@/lib/components/section-nav-dropdown'
import type {
  SectionNavFooter,
  SectionNavGroup
} from '@/lib/components/section-nav-shared'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn()
}))

// A flat section: Fitness and Gallery pass one headless group.
const fitnessGroups: SectionNavGroup[] = [
  {
    items: [
      { name: 'Overview', url: '/fitness', icon: <Activity /> },
      { name: 'Files', url: '/fitness/files', icon: <Files /> },
      { name: 'Privacy', url: '/fitness/privacy', icon: <Lock /> },
      { name: 'Strava', url: '/fitness/strava', icon: <Globe /> }
    ]
  }
]

// Admin: a headless Dashboard, then headed groups; Reports carries a count.
const adminGroups = (badge?: number): SectionNavGroup[] => [
  {
    items: [{ name: 'Dashboard', url: '/admin/overview', icon: <Activity /> }]
  },
  {
    heading: 'Moderation',
    items: [
      {
        name: 'Reports',
        url: '/admin/reports',
        icon: <Ban />,
        badge,
        badgeLabel: 'unresolved reports'
      },
      { name: 'Accounts', url: '/admin/accounts', icon: <User /> }
    ]
  },
  {
    heading: 'Maintenance',
    items: [
      { name: 'Queues', url: '/admin/queues', icon: <Files /> },
      { name: 'System', url: '/admin/system', icon: <Globe /> }
    ]
  }
]

// Settings: a menu-only Edit profile, headed groups, an after-footer run and
// the cross-link footer.
const settingsGroups: SectionNavGroup[] = [
  {
    menuOnly: true,
    items: [{ name: 'Edit profile', url: '/settings/profile', icon: <User /> }]
  },
  {
    heading: 'Preferences',
    items: [{ name: 'Appearance', url: '/settings/appearance', icon: <Sun /> }]
  },
  {
    heading: 'Privacy & safety',
    items: [
      { name: 'Blocked accounts', url: '/settings/blocks', icon: <Ban /> }
    ]
  },
  {
    afterFooter: true,
    items: [
      { name: 'Moving', url: '/settings/moving', icon: <Globe /> },
      { name: 'Delete this profile', url: '/settings/delete', icon: <Trash2 /> }
    ]
  }
]
const settingsFooter: SectionNavFooter = {
  heading: 'Shared across your profiles',
  item: { name: 'Account & security', url: '/account', icon: <ShieldCheck /> }
}

// Account: one run whose first item also answers to verify-email.
const accountGroups: SectionNavGroup[] = [
  {
    items: [
      {
        name: 'Email & name',
        url: '/account/email',
        alsoMatches: ['/account/verify-email'],
        icon: <Mail />
      },
      { name: 'Password & sign-in', url: '/account/security', icon: <Lock /> }
    ]
  }
]

// The shared item's base class always carries its `data-[variant=destructive]:`
// variants, so assert on an unconditional destructive colour instead.
const DESTRUCTIVE_COLOUR = /(^|\s)(text|bg)-destructive/

const setPath = (path: string) =>
  (usePathname as jest.Mock).mockReturnValue(path)

// Open the Radix menu via keyboard (jsdom has no pointer layout), then scope
// assertions to the open menu.
const openMenu = async (navName: string) => {
  const nav = screen.getByRole('navigation', { name: navName })
  fireEvent.keyDown(within(nav).getByRole('button'), { key: 'ArrowDown' })
  return screen.findByRole('menu')
}

const renderFitness = () =>
  render(<SectionNavDropdown label="Fitness" groups={fitnessGroups} />)

describe('SectionNavDropdown', () => {
  it('labels the nav landmark and reflects the active tab in the trigger', () => {
    setPath('/fitness')
    renderFitness()

    const nav = screen.getByRole('navigation', { name: 'Fitness' })
    expect(within(nav).getByRole('button')).toHaveTextContent('Overview')
  })

  it('resolves the most-specific tab, not a shorter prefix', () => {
    setPath('/fitness/files/abc123')
    renderFitness()

    const nav = screen.getByRole('navigation', { name: 'Fitness' })
    // '/fitness' (Overview) is a prefix but must not win over '/fitness/files'.
    expect(within(nav).getByRole('button')).toHaveTextContent('Files')
  })

  it('names the section on the trigger when the path matches nothing, with no current row', async () => {
    setPath('/somewhere/else')
    renderFitness()

    const nav = screen.getByRole('navigation', { name: 'Fitness' })
    expect(within(nav).getByRole('button')).toHaveTextContent('Fitness')

    const menu = await openMenu('Fitness')
    for (const item of within(menu).getAllByRole('menuitem')) {
      expect(item).not.toHaveAttribute('aria-current')
    }
  })

  it('lists every tab as a menu item and marks the active one current', async () => {
    setPath('/fitness/strava')
    renderFitness()

    const menu = await openMenu('Fitness')
    for (const tab of fitnessGroups[0].items) {
      const item = within(menu).getByRole('menuitem', { name: tab.name })
      expect(item).toBeInTheDocument()
      // Guard against a tab URL regression going undetected.
      expect(item).toHaveAttribute('href', tab.url)
    }
    expect(
      within(menu).getByRole('menuitem', { name: 'Strava' })
    ).toHaveAttribute('aria-current', 'page')
    expect(
      within(menu).getByRole('menuitem', { name: 'Overview' })
    ).not.toHaveAttribute('aria-current')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .filter((item) => item.getAttribute('aria-current') === 'page')
    ).toHaveLength(1)
  })

  // The active row holds its orange wash on focus so hovering the current
  // section doesn't flash it grey — which means focus and rest would otherwise
  // render identically, and a keyboard user arrowing down the menu would watch
  // the highlight disappear on exactly that row (WCAG 2.4.7). A focus ring is
  // what keeps the two apart. jsdom has no Tailwind, so assert on the utility
  // rather than on a computed style; without it the row has no focus
  // affordance at all, since the shared item base sets `outline-hidden`.
  it('keeps a focus indicator on the active row, which pins its own colours', async () => {
    setPath('/fitness/strava')
    renderFitness()

    const menu = await openMenu('Fitness')
    const active = within(menu).getByRole('menuitem', { name: 'Strava' })
    expect(active.className).toMatch(/focus:bg-primary\/10/)
    expect(active.className).toMatch(/focus:ring-2/)
    // The shared item carries `dark:focus:bg-muted`, and tailwind-merge only
    // drops it for a `dark:focus:` class of the same family. Without that dark
    // twin the hovered current row turns grey in dark instead of holding its
    // wash.
    expect(active.className).toMatch(/dark:focus:bg-primary\/10/)
    expect(active.className).not.toMatch(/dark:focus:bg-muted/)
    // `text-primary-text`, never `text-primary`: `--primary` is the icon
    // orange and is under the AA floor as a foreground. This assertion and the
    // identical one in `section-nav-select.test.tsx` are the only two things in
    // the repo that catch that regression — `app/globals.contrast.test.ts`
    // guards the token values, never their usage — and the pair has to hold on
    // BOTH, since a gear's page renders the two dropdowns one above the other.
    expect(active.className).toMatch(/text-primary-text/)

    // Inactive rows keep the shared grey focus wash, so they need no ring.
    const inactive = within(menu).getByRole('menuitem', { name: 'Overview' })
    expect(inactive.className).not.toMatch(/focus:ring-2/)
  })

  it('keeps rendered icons on the row colour, not the shared muted-svg rule', async () => {
    setPath('/fitness/strava')
    renderFitness()

    const menu = await openMenu('Fitness')
    const active = within(menu).getByRole('menuitem', { name: 'Strava' })
    // The merge dropped the shared `[&_svg:not([class*='text-'])]:text-muted-foreground`
    // and put `text-current` in its place, so the icon takes its wrapper's colour.
    expect(active.className).toMatch(/text-current/)
    expect(active.className).not.toMatch(/text-muted-foreground/)
    expect(active.querySelector('span')).toHaveClass('text-primary')

    const inactive = within(menu).getByRole('menuitem', { name: 'Overview' })
    expect(inactive.querySelector('span')).toHaveClass(
      'text-popover-foreground'
    )
  })

  describe('groups', () => {
    it('sets headed groups off under their headings and leaves a headless run plain', async () => {
      setPath('/admin/accounts')
      render(<SectionNavDropdown label="Admin" groups={adminGroups(3)} />)

      const menu = await openMenu('Admin')
      // Dashboard is a headless run, not an unnamed group.
      expect(within(menu).getAllByRole('group')).toHaveLength(2)

      const moderation = within(menu).getByRole('group', { name: 'Moderation' })
      expect(
        within(moderation).getByRole('menuitem', { name: /Reports/ })
      ).toBeInTheDocument()
      expect(
        within(moderation).getByRole('menuitem', { name: 'Accounts' })
      ).toBeInTheDocument()
      expect(
        within(menu).getByRole('group', { name: 'Maintenance' })
      ).toBeInTheDocument()
      // The headless Dashboard sits outside both groups.
      expect(
        within(moderation).queryByRole('menuitem', { name: 'Dashboard' })
      ).not.toBeInTheDocument()
      // First block headless, the rest headed: nothing to separate.
      expect(within(menu).queryByRole('separator')).not.toBeInTheDocument()
    })

    it('names the groups in order', async () => {
      setPath('/admin/accounts')
      render(<SectionNavDropdown label="Admin" groups={adminGroups(3)} />)

      const menu = await openMenu('Admin')
      const names = within(menu)
        .getAllByRole('group')
        .map((group) => {
          const labelId = group.getAttribute('aria-labelledby') ?? ''
          return document.getElementById(labelId)?.textContent
        })
      expect(names).toEqual(['Moderation', 'Maintenance'])
    })

    it('separates the cross-link and the after-footer run, and keeps menu-only groups', async () => {
      setPath('/settings/appearance')
      render(
        <SectionNavDropdown
          label="Settings"
          groups={settingsGroups}
          footer={settingsFooter}
          indexUrl="/settings"
        />
      )

      const menu = await openMenu('Settings')
      expect(within(menu).getAllByRole('separator')).toHaveLength(2)
      expect(
        within(menu)
          .getAllByRole('menuitem')
          .map((item) => item.getAttribute('href'))
      ).toEqual([
        '/settings/profile',
        '/settings/appearance',
        '/settings/blocks',
        '/account',
        '/settings/moving',
        '/settings/delete'
      ])
    })

    it('renders a single headless group as one plain run', async () => {
      setPath('/fitness')
      renderFitness()

      const menu = await openMenu('Fitness')
      expect(within(menu).queryAllByRole('group')).toHaveLength(0)
      expect(within(menu).queryAllByRole('separator')).toHaveLength(0)
      expect(
        menu.querySelectorAll('[data-slot="dropdown-menu-label"]')
      ).toHaveLength(0)
    })
  })

  it('lets a page nested under an item name its parent through alsoMatches', async () => {
    setPath('/account/verify-email')
    render(
      <SectionNavDropdown
        label="Account & security"
        groups={accountGroups}
        indexUrl="/account"
      />
    )

    const nav = screen.getByRole('navigation', { name: 'Account & security' })
    expect(within(nav).getByRole('button')).toHaveTextContent('Email & name')

    const menu = await openMenu('Account & security')
    expect(
      within(menu).getByRole('menuitem', { name: 'Email & name' })
    ).toHaveAttribute('aria-current', 'page')
  })

  it('caps the menu to the available height and scrolls inside it', async () => {
    setPath('/fitness')
    renderFitness()

    const menu = await openMenu('Fitness')
    expect(menu.className).toMatch(
      /max-h-\(--radix-dropdown-menu-content-available-height\)/
    )
    expect(menu.className).toMatch(/overflow-y-auto/)
    expect(menu.className).not.toMatch(/max-h-\[/)
  })

  it('opens on the current page: the current row takes focus', async () => {
    setPath('/admin/system')
    render(<SectionNavDropdown label="Admin" groups={adminGroups(3)} />)

    const menu = await openMenu('Admin')
    await waitFor(() =>
      expect(
        within(menu).getByRole('menuitem', { name: 'System' })
      ).toHaveFocus()
    )
  })

  it('scrolls the menu, not the window, to the current row', async () => {
    // jsdom has no layout, so the rects are mocked: the menu spans 0..100 and
    // the current row sits below its fold.
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute('role') === 'menu')
          return { top: 0, bottom: 100 } as DOMRect
        if (this.getAttribute('aria-current') === 'page')
          return { top: 150, bottom: 180 } as DOMRect
        return { top: 0, bottom: 0 } as DOMRect
      })
    try {
      setPath('/admin/system')
      render(<SectionNavDropdown label="Admin" groups={adminGroups(3)} />)

      const menu = await openMenu('Admin')
      // 180 + 4px of room for the focus ring - 100.
      await waitFor(() => expect(menu.scrollTop).toBe(84))
    } finally {
      rectSpy.mockRestore()
    }
  })

  it('does not pull the menu back once focus has moved off the current row', async () => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute('role') === 'menu')
          return { top: 0, bottom: 100 } as DOMRect
        if (this.getAttribute('aria-current') === 'page')
          return { top: 150, bottom: 180 } as DOMRect
        return { top: 0, bottom: 0 } as DOMRect
      })
    try {
      setPath('/admin/system')
      render(<SectionNavDropdown label="Admin" groups={adminGroups(3)} />)

      const menu = await openMenu('Admin')
      await waitFor(() => expect(menu.scrollTop).toBe(84))

      // The user moves on and scrolls the menu to the top before the 300ms
      // re-reveal fires.
      within(menu).getByRole('menuitem', { name: 'Dashboard' }).focus()
      menu.scrollTop = 0
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(menu.scrollTop).toBe(0)
    } finally {
      rectSpy.mockRestore()
    }
  })

  it('sizes rows for touch and truncates long names', async () => {
    setPath('/fitness/strava')
    renderFitness()

    const nav = screen.getByRole('navigation', { name: 'Fitness' })
    const trigger = within(nav).getByRole('button')
    expect(trigger.querySelector('.truncate')).toHaveTextContent('Strava')

    const menu = await openMenu('Fitness')
    for (const item of within(menu).getAllByRole('menuitem')) {
      expect(item.className).toContain('pointer-coarse:min-h-11')
      expect(item.querySelector('.truncate')).toBeInTheDocument()
    }
  })

  describe('open-report count', () => {
    it('shows the count on the Reports row, never on the trigger', async () => {
      setPath('/admin/accounts')
      render(<SectionNavDropdown label="Admin" groups={adminGroups(3)} />)

      const nav = screen.getByRole('navigation', { name: 'Admin' })
      const trigger = within(nav).getByRole('button')
      expect(trigger).not.toHaveTextContent('3')
      expect(trigger.textContent).not.toMatch(/unresolved/)

      const menu = await openMenu('Admin')
      const row = within(menu).getByRole('menuitem', {
        name: /Reports\s*\(3 unresolved reports\)/
      })
      const badge = within(row).getByText('3')
      expect(badge).toHaveAttribute('aria-hidden', 'true')
      expect(badge).toHaveClass('static')
    })

    it.each([[0], [undefined]])(
      'shows no count when it is %s',
      async (badge) => {
        setPath('/admin/accounts')
        render(<SectionNavDropdown label="Admin" groups={adminGroups(badge)} />)

        const menu = await openMenu('Admin')
        expect(
          within(menu).getByRole('menuitem', { name: 'Reports' })
        ).toBeInTheDocument()
        expect(within(menu).queryByText(/unresolved/)).not.toBeInTheDocument()
      }
    )

    it('caps a large count at 99+ and keeps the exact number for screen readers', async () => {
      setPath('/admin/accounts')
      render(<SectionNavDropdown label="Admin" groups={adminGroups(103)} />)

      const menu = await openMenu('Admin')
      expect(within(menu).getByText('99+')).toBeInTheDocument()
      expect(within(menu).getByText('(103 unresolved reports)')).toHaveClass(
        'sr-only'
      )
    })
  })

  describe('foot rows', () => {
    const renderSettings = () =>
      render(
        <SectionNavDropdown
          label="Settings"
          groups={settingsGroups}
          footer={settingsFooter}
          indexUrl="/settings"
        />
      )

    it('renders the cross-link as a plain row that is never current', async () => {
      setPath('/account')
      renderSettings()

      const menu = await openMenu('Settings')
      const row = within(menu).getByRole('menuitem', {
        name: 'Account & security'
      })
      expect(row).toHaveAttribute('href', '/account')
      expect(row).not.toHaveAttribute('aria-current')
      expect(row.className).not.toMatch(DESTRUCTIVE_COLOUR)
      // No second line: the footer's heading belongs to the index only.
      expect(
        within(menu).queryByText('Shared across your profiles')
      ).not.toBeInTheDocument()
    })

    it('does not colour "Delete this profile" as destructive: it is a page', async () => {
      setPath('/settings/appearance')
      renderSettings()

      const menu = await openMenu('Settings')
      const row = within(menu).getByRole('menuitem', {
        name: 'Delete this profile'
      })
      expect(row.className).not.toMatch(DESTRUCTIVE_COLOUR)
      expect(row).toHaveAttribute('data-variant', 'default')
    })
  })

  describe('the way back (list-page link)', () => {
    it('puts a link to the list page before the trigger', () => {
      setPath('/admin/system')
      render(
        <SectionNavDropdown
          label="Admin"
          groups={adminGroups()}
          indexUrl="/admin"
        />
      )

      const nav = screen.getByRole('navigation', { name: 'Admin' })
      // jsdom's accessible-name computation drops the space before the visually
      // hidden suffix (a browser keeps it), hence `\s*`.
      const link = within(nav).getByRole('link', {
        name: /^Admin\s*\(all pages\)$/
      })
      expect(link).toHaveAttribute('href', '/admin')
      const trigger = within(nav).getByRole('button')
      expect(trigger).toHaveTextContent('System')
      // The trigger follows the link.
      expect(
        link.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      // The slash is decoration, and the row is no breadcrumb.
      expect(nav.querySelector('[aria-hidden="true"]')).toHaveTextContent('/')
      expect(screen.queryByRole('list')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('navigation', { name: 'Breadcrumb' })
      ).not.toBeInTheDocument()
    })

    it('shows the short label below md and the full label from md up', () => {
      setPath('/account/email')
      render(
        <SectionNavDropdown
          label="Account & security"
          shortLabel="Account"
          groups={accountGroups}
          indexUrl="/account"
        />
      )

      const nav = screen.getByRole('navigation', { name: 'Account & security' })
      // jsdom has no CSS, so both spans are in the accessible name (only the
      // `max-md:hidden` / `md:hidden` classes hide one); assert the pieces
      // instead of the exact doubled string.
      const link = within(nav).getByRole('link', { name: /all pages\)$/ })
      expect(link).toHaveAttribute('href', '/account')
      expect(link).toHaveTextContent('Account & security')
      expect(within(link).getByText('Account & security')).toHaveClass(
        'max-md:hidden'
      )
      expect(within(link).getByText('Account')).toHaveClass('md:hidden')
    })

    it('renders the trigger alone without a list page', () => {
      setPath('/fitness')
      renderFitness()

      const nav = screen.getByRole('navigation', { name: 'Fitness' })
      expect(within(nav).queryByRole('link')).not.toBeInTheDocument()
      expect(nav).not.toHaveTextContent('/')
    })
  })

  it('renders nothing for a section without items', () => {
    setPath('/fitness')
    const { container } = render(
      <SectionNavDropdown label="Fitness" groups={[]} />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
