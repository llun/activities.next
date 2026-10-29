/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { usePathname } from 'next/navigation'

import {
  SectionIndex,
  SectionLayout,
  type SectionNavFooter,
  type SectionNavGroup
} from './section-nav'
import { resolveActiveSectionUrl } from './sectionNavActive'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn()
}))

const groups: SectionNavGroup[] = [
  {
    menuOnly: true,
    items: [{ name: 'Profile', url: '/s/profile', icon: null }]
  },
  {
    heading: 'First',
    items: [
      { name: 'One', url: '/s/one', icon: null, description: 'One line' },
      { name: 'Two', url: '/s/two', icon: null }
    ]
  },
  {
    heading: 'Second',
    items: [{ name: 'Three', url: '/s/three', icon: null }]
  },
  { afterFooter: true, items: [{ name: 'Last', url: '/s/last', icon: null }] }
]

const footer: SectionNavFooter = {
  heading: 'Elsewhere',
  item: { name: 'Other', url: '/other', icon: null, description: 'What' }
}

const reportGroups = (badge?: number): SectionNavGroup[] => [
  {
    heading: 'Moderation',
    items: [
      {
        name: 'Reports',
        url: '/admin/reports',
        icon: null,
        ...(badge !== undefined ? { badge } : null),
        badgeLabel: 'unresolved reports'
      }
    ]
  }
]

describe('resolveActiveSectionUrl', () => {
  const urls = ['/account', '/account/security']

  it('takes the most specific parent of the path', () => {
    expect(resolveActiveSectionUrl('/account/security/keys', urls)).toBe(
      '/account/security'
    )
    expect(resolveActiveSectionUrl('/account', urls)).toBe('/account')
  })

  it('does not match a sibling that only shares a prefix', () => {
    expect(resolveActiveSectionUrl('/accounts', urls)).toBeUndefined()
  })
})

describe('long names', () => {
  const long: SectionNavFooter = {
    heading: 'Elsewhere',
    item: {
      name: 'Settings for @someone@very-long-domain.example.social',
      url: '/other',
      icon: null,
      description: 'What'
    }
  }

  it('wraps the index names anywhere', () => {
    render(<SectionIndex groups={groups} footer={long} />)
    expect(screen.getByText(long.item.name)).toHaveClass(
      '[overflow-wrap:anywhere]'
    )
    expect(screen.getByText('One')).toHaveClass('[overflow-wrap:anywhere]')
    expect(screen.getByText('One line')).toHaveClass('[overflow-wrap:anywhere]')
  })

  it('renders no row without items', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s/one')
    render(
      <SectionLayout label="Things" title="Things" groups={[]}>
        <p>body</p>
      </SectionLayout>
    )
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })
})

describe('SectionIndex', () => {
  it('renders blocks in order: groups, footer card, after-footer groups', () => {
    render(<SectionIndex groups={groups} footer={footer} />)

    expect(
      screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    ).toEqual(['/s/one', '/s/two', '/s/three', '/other', '/s/last'])
  })

  it('lists the groups, then the footer, then after-footer groups, without menu-only groups', () => {
    render(<SectionIndex groups={groups} footer={footer} />)

    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    ).toEqual(['First', 'Second', 'Elsewhere'])
    expect(
      screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    ).toEqual(['/s/one', '/s/two', '/s/three', '/other', '/s/last'])
    expect(screen.getByText('One line')).toHaveClass('max-lg:hidden')
    // The cross-link card keeps its line on phones.
    expect(screen.getByText('What')).not.toHaveClass('max-lg:hidden')
  })

  it('renders a headless run as a plain block, not an unnamed section', () => {
    const { container } = render(
      <SectionIndex groups={groups} footer={footer} />
    )

    const last = screen.getByRole('link', { name: 'Last' }).closest('ul')
    expect(last?.closest('section')).toBeNull()
    expect(container.querySelectorAll('section')).toHaveLength(3)
  })

  it('renders the report badge and its accessible count in the index row', () => {
    render(<SectionIndex groups={reportGroups(7)} />)

    const link = screen.getByRole('link', {
      name: /Reports\s*\(7 unresolved reports\)/
    })
    const badge = link.querySelector('[aria-hidden="true"]')
    expect(badge).toHaveTextContent('7')
    expect(badge).toHaveClass('static')
    expect(link.querySelector('.sr-only')).toHaveTextContent(
      '(7 unresolved reports)'
    )
  })

  it('caps the visible count at 99+ and keeps the full screen reader count', () => {
    render(<SectionIndex groups={reportGroups(103)} />)

    expect(screen.getByText('99+')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('(103 unresolved reports)')).toHaveClass('sr-only')
  })

  it.each([0, undefined])(
    'does not render a badge for a count of %s',
    (badge) => {
      render(<SectionIndex groups={reportGroups(badge)} />)

      expect(screen.getByRole('link', { name: 'Reports' })).toBeInTheDocument()
      expect(screen.queryByText('0')).not.toBeInTheDocument()
      expect(screen.queryByText(/unresolved reports/)).not.toBeInTheDocument()
    }
  )

  // The fixture's blocks in order: First, Second, the footer card, then the
  // after-footer run (Last), all in one column.
  it('renders one column capped at 680px', () => {
    const { container } = render(
      <SectionIndex groups={groups} footer={footer} />
    )

    const column = container.firstElementChild as HTMLElement
    expect(column).toHaveClass('max-w-[680px]', 'flex-col')
    expect(container.querySelector('.lg\\:grid-cols-2')).toBeNull()
  })

  it('colours the name and icon of a danger item destructive', () => {
    render(
      <SectionIndex
        groups={[
          {
            heading: 'Danger',
            items: [
              { name: 'Delete', url: '/delete', icon: null, danger: true }
            ]
          }
        ]}
      />
    )

    // The icon span and the name span both carry the destructive colour.
    const link = screen.getByRole('link', { name: 'Delete' })
    expect(link.querySelectorAll('.text-destructive')).toHaveLength(2)
    expect(link.firstElementChild).toHaveClass('text-destructive')
    expect(screen.getByText('Delete')).toHaveClass('text-destructive')
  })
})

describe('SectionLayout', () => {
  const renderLayout = () =>
    render(
      <SectionLayout
        label="Things"
        title="Things"
        description="For you"
        indexUrl="/s"
        groups={groups}
        footer={footer}
      >
        <div>content</div>
      </SectionLayout>
    )

  const openMenu = async () => {
    const nav = screen.getByRole('navigation', { name: 'Things' })
    fireEvent.keyDown(within(nav).getByRole('button'), { key: 'ArrowDown' })
    return screen.findByRole('menu')
  }

  it('renders the section row on a section page', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s/one')
    const { container } = renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Things' })
    // jsdom drops the space before the visually hidden suffix (a browser
    // keeps it), hence `\s*`.
    const link = within(nav).getByRole('link', {
      name: /^Things\s*\(all pages\)$/
    })
    expect(link).toHaveAttribute('href', '/s')
    expect(within(nav).getByRole('button')).toHaveTextContent('One')
    expect(
      screen.queryByRole('link', { name: /^Back/ })
    ).not.toBeInTheDocument()
    // The wide column and its rail are gone: the title row keeps the unified
    // content width.
    expect(container.querySelector('[data-section-layout]')).toBeNull()
    const heading = screen.getByRole('heading', { level: 1, name: 'Things' })
    expect(heading.closest('.max-w-content')?.className).not.toMatch(
      /max-w-section/
    )
  })

  it('renders the index and no row on the index route', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s')
    renderLayout()

    expect(
      screen.queryByRole('navigation', { name: 'Things' })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /all pages/ })
    ).not.toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'First' })).toBeInTheDocument()
  })

  it('renders the dropdown without a list-page link in a section without an index', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s/one')
    render(
      <SectionLayout label="Things" title="Things" groups={groups}>
        <div>content</div>
      </SectionLayout>
    )

    const nav = screen.getByRole('navigation', { name: 'Things' })
    expect(within(nav).getByRole('button')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /all pages/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /^Back/ })
    ).not.toBeInTheDocument()
  })

  it('shows the section header box below md only on the index, or without an index', () => {
    const headerBox = () =>
      screen
        .getByRole('heading', { level: 1, name: 'Things' })
        .closest('.max-w-content')!.parentElement!
    const row = () => screen.getByText('content').parentElement as HTMLElement

    ;(usePathname as jest.Mock).mockReturnValue('/s/one')
    const { unmount } = renderLayout()
    expect(headerBox()).toHaveClass('max-md:hidden')
    // The row opens 12px under the compact bar, 16px under the header box
    // from md up.
    expect(row()).toHaveClass('pt-4', 'max-md:pt-3')
    unmount()

    ;(usePathname as jest.Mock).mockReturnValue('/s')
    renderLayout()
    expect(headerBox()).not.toHaveClass('max-md:hidden')
    expect(row()).toHaveClass('max-md:pt-0')
  })

  it('keeps the header box below md in a section without an index', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s/one')
    render(
      <SectionLayout label="Things" title="Things" groups={groups}>
        <div>content</div>
      </SectionLayout>
    )

    const headerBox = screen
      .getByRole('heading', { level: 1, name: 'Things' })
      .closest('.max-w-content')!.parentElement!
    expect(headerBox).not.toHaveClass('max-md:hidden')
    const row = screen.getByText('content').parentElement as HTMLElement
    expect(row).toHaveClass('max-md:pt-0')
    expect(row).not.toHaveClass('max-md:pt-3')
  })

  it('shows the row on a page nested under an item, naming the item', async () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s/one/detail')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Things' })
    expect(within(nav).getByRole('button')).toHaveTextContent('One')

    const menu = await openMenu()
    expect(within(menu).getByRole('menuitem', { name: 'One' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  it('names the section on a page no item matches', async () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s/verify-email')
    renderLayout()

    const nav = screen.getByRole('navigation', { name: 'Things' })
    expect(within(nav).getByRole('button')).toHaveTextContent('Things')
    expect(
      within(nav).getByRole('link', { name: /all pages/ })
    ).toHaveAttribute('href', '/s')

    const menu = await openMenu()
    for (const item of within(menu).getAllByRole('menuitem')) {
      expect(item).not.toHaveAttribute('aria-current')
    }
  })

  it('leaves no top-margin gap above the index when the page renders nothing', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s')
    const NullPage = () => null
    render(
      <SectionLayout
        label="Things"
        title="Things"
        indexUrl="/s"
        groups={groups}
        footer={footer}
      >
        <NullPage />
      </SectionLayout>
    )

    const wrapper = screen
      .getByRole('heading', { name: 'First' })
      .closest('.max-w-\\[680px\\]')!.parentElement!
    // The margin is conditional: a null page leaves the wrapper the column's
    // first child, so `[&:not(:first-child)]:mt-6` does not apply.
    expect(wrapper).toHaveClass('[&:not(:first-child)]:mt-6')
    expect(wrapper.parentElement!.firstElementChild).toBe(wrapper)
  })

  it('keeps the top margin above the index when the page renders content', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s')
    renderLayout()

    const wrapper = screen
      .getByRole('heading', { name: 'First' })
      .closest('.max-w-\\[680px\\]')!.parentElement!
    expect(wrapper.previousElementSibling).toHaveTextContent('content')
  })
})
