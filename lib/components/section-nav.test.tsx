/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { usePathname } from 'next/navigation'

import {
  SectionIndex,
  SectionLayout,
  SectionNav,
  type SectionNavFooter,
  type SectionNavGroup
} from './section-nav'
import { resolveActiveSectionUrl } from './sectionNavActive'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn()
}))

const groups: SectionNavGroup[] = [
  {
    railOnly: true,
    items: [{ name: 'Profile', url: '/s/profile', icon: null, hint: '@a@b' }]
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

describe('SectionNav', () => {
  it('labels each headed group by its heading and marks the active row', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s/two/detail')
    render(<SectionNav label="Things" groups={groups} footer={footer} />)

    const nav = screen.getByRole('navigation', { name: 'Things' })
    const first = within(nav).getByRole('group', { name: 'First' })
    expect(
      within(first)
        .getAllByRole('link')
        .map((link) => link.textContent)
    ).toEqual(['One', 'Two'])
    expect(within(first).getByRole('link', { name: 'Two' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(
      within(first).getByRole('link', { name: 'One' })
    ).not.toHaveAttribute('aria-current')
  })

  it('names every group it exposes: headless runs are not groups', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s/one')
    render(<SectionNav label="Things" groups={groups} footer={footer} />)

    expect(
      screen.getAllByRole('group').map((group) => group.textContent)
    ).toEqual(['FirstOneTwo', 'SecondThree'])
  })

  it('shows rail-only groups with their hint, and the footer with its heading', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s/one')
    render(<SectionNav label="Things" groups={groups} footer={footer} />)

    expect(screen.getByRole('link', { name: /Profile/ })).toHaveTextContent(
      '@a@b'
    )
    const other = screen.getByRole('link', { name: /Other/ })
    expect(other).toHaveAttribute('href', '/other')
    expect(other).toHaveTextContent('Elsewhere')
  })

  it('scrolls the rail, not the window, to the active row, and again when it changes', () => {
    // The nav is the scroll container (`overflow-y-auto`); jsdom has no
    // layout, so the rects are mocked: the nav spans 0..100, the active row
    // first sits below the fold, then above it.
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.tagName === 'NAV') return { top: 0, bottom: 100 } as DOMRect
        if (this.getAttribute('aria-current') === 'page')
          return { top: 150, bottom: 180 } as DOMRect
        return { top: 0, bottom: 0 } as DOMRect
      })
    try {
      ;(usePathname as jest.Mock).mockReturnValue('/s/two')
      const { rerender } = render(
        <SectionNav label="Things" groups={groups} footer={footer} />
      )

      const nav = screen.getByRole('navigation', { name: 'Things' })
      expect(screen.getByRole('link', { name: 'Two' })).toHaveAttribute(
        'aria-current',
        'page'
      )
      expect(nav.scrollTop).toBe(80)

      // Navigating within the section re-runs the effect with the new row.
      rectSpy.mockImplementation(function (this: HTMLElement) {
        if (this.tagName === 'NAV') return { top: 0, bottom: 100 } as DOMRect
        if (this.getAttribute('aria-current') === 'page')
          return { top: -30, bottom: 0 } as DOMRect
        return { top: 0, bottom: 0 } as DOMRect
      })
      ;(usePathname as jest.Mock).mockReturnValue('/s/three')
      rerender(<SectionNav label="Things" groups={groups} footer={footer} />)

      expect(screen.getByRole('link', { name: 'Three' })).toHaveAttribute(
        'aria-current',
        'page'
      )
      expect(nav.scrollTop).toBe(50)
    } finally {
      rectSpy.mockRestore()
    }
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

  it('wraps the rail footer name and the index names anywhere', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s/one')
    const { unmount } = render(
      <SectionNav label="Things" groups={groups} footer={long} />
    )
    expect(screen.getByText(long.item.name)).toHaveClass(
      '[overflow-wrap:anywhere]'
    )
    unmount()

    render(<SectionIndex groups={groups} footer={long} />)
    expect(screen.getByText(long.item.name)).toHaveClass(
      '[overflow-wrap:anywhere]'
    )
    expect(screen.getByText('One')).toHaveClass('[overflow-wrap:anywhere]')
    expect(screen.getByText('One line')).toHaveClass('[overflow-wrap:anywhere]')
  })

  it('renders no rail without groups or footer', () => {
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
  it('lists the groups, then the footer, then after-footer groups, without rail-only groups', () => {
    render(<SectionIndex groups={groups} footer={footer} />)

    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    ).toEqual(['First', 'Second', 'Elsewhere'])
    expect(
      screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    ).toEqual(['/s/one', '/s/two', '/s/three', '/other', '/s/last'])
    expect(screen.queryByText('@a@b')).not.toBeInTheDocument()
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

  // The fixture's blocks: First, Second, the footer card, then the
  // after-footer run (Last).
  const columnHrefs = (container: HTMLElement) => {
    const grid = container.firstElementChild as HTMLElement
    return Array.from(grid.children).map((column) =>
      Array.from(column.querySelectorAll('a')).map((link) =>
        link.getAttribute('href')
      )
    )
  }

  it('keeps the first block in the left column by default', () => {
    const { container } = render(
      <SectionIndex groups={groups} footer={footer} />
    )

    expect(columnHrefs(container)).toEqual([
      ['/s/one', '/s/two'],
      ['/s/three', '/other', '/s/last']
    ])
  })

  it('puts the first splitAt blocks in the left column', () => {
    const { container } = render(
      <SectionIndex groups={groups} footer={footer} splitAt={3} />
    )

    expect(columnHrefs(container)).toEqual([
      ['/s/one', '/s/two', '/s/three', '/other'],
      ['/s/last']
    ])
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

  it('renders the rail from lg up and the Back row below lg on a section page', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s/one')
    renderLayout()

    expect(screen.getByRole('navigation', { name: 'Things' })).toHaveClass(
      'max-lg:hidden'
    )
    const back = screen.getByRole('link', { name: 'Back to things' })
    expect(back).toHaveAttribute('href', '/s')
    expect(back).toHaveTextContent('Back to Things')
    expect(back).toHaveClass('lg:hidden')
  })

  it('renders the index instead of the rail and Back on the index route', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s')
    renderLayout()

    expect(
      screen.queryByRole('navigation', { name: 'Things' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Back to things' })
    ).not.toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'First' })).toBeInTheDocument()
  })

  it('wraps the section header in the data-section-layout hook the wide column keys on', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s/one')
    const { container } = renderLayout()

    const root = container.firstElementChild
    expect(root).toHaveAttribute('data-section-layout')
    // The shell (`[&:has([data-section-layout])]`) and the header's title row
    // (`[[data-section-layout]_&]`) only widen when the header sits inside it.
    const heading = screen.getByRole('heading', { level: 1, name: 'Things' })
    expect(root).toContainElement(heading)
    expect(heading.closest('.max-w-content')).toHaveClass(
      '[[data-section-layout]_&]:max-w-section'
    )
  })
  it('has no Back row without an index', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s/one')
    render(
      <SectionLayout label="Things" title="Things" groups={groups}>
        <div>content</div>
      </SectionLayout>
    )

    expect(
      screen.queryByRole('link', { name: /^Back/ })
    ).not.toBeInTheDocument()
    // Rail stays; no index means no index list either.
    expect(
      screen.getByRole('navigation', { name: 'Things' })
    ).toBeInTheDocument()
  })

  it('shows the section header box below md only on the index, or without an index', () => {
    const headerBox = () =>
      screen
        .getByRole('heading', { level: 1, name: 'Things' })
        .closest('.max-w-content')!.parentElement!
    const row = () =>
      screen.getByText('content').closest('.gap-6') as HTMLElement

    ;(usePathname as jest.Mock).mockReturnValue('/s/one')
    const { unmount } = renderLayout()
    expect(headerBox()).toHaveClass('max-md:hidden')
    expect(row()).toHaveClass('max-md:pt-2')
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
    const row = screen.getByText('content').closest('.gap-6') as HTMLElement
    expect(row).toHaveClass('max-md:pt-0')
    expect(row).not.toHaveClass('max-md:pt-2')
  })

  it('hides the Back row on a detail page under an item, which renders its own Back', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s/one/detail')
    renderLayout()

    expect(
      screen.queryByRole('link', { name: 'Back to things' })
    ).not.toBeInTheDocument()
    // The rail still marks the item the detail page sits under.
    expect(screen.getByRole('link', { name: 'One' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  it('shows the Back row on a page that is neither an item nor nested under one', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s/verify-email')
    renderLayout()

    const back = screen.getByRole('link', { name: 'Back to things' })
    expect(back).toHaveAttribute('href', '/s')
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
      .closest('.grid')!.parentElement!
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
      .closest('.grid')!.parentElement!
    expect(wrapper.previousElementSibling).toHaveTextContent('content')
  })

  it('passes splitAt through to the index', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s')
    render(
      <SectionLayout
        label="Things"
        title="Things"
        indexUrl="/s"
        groups={groups}
        footer={footer}
        splitAt={3}
      >
        <div>content</div>
      </SectionLayout>
    )

    const grid = screen
      .getByRole('heading', { name: 'First' })
      .closest('.grid')!
    const columns = Array.from(grid.children).map((column) =>
      Array.from(column.querySelectorAll('a')).map((link) =>
        link.getAttribute('href')
      )
    )
    expect(columns).toEqual([
      ['/s/one', '/s/two', '/s/three', '/other'],
      ['/s/last']
    ])
  })

  it('uses the footer hint for the rail card when given', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/s/one')
    render(
      <SectionNav
        label="Things"
        groups={groups}
        footer={{ ...footer, hint: 'Each has its own' }}
      />
    )

    const card = screen.getByRole('link', { name: /Other/ })
    expect(card).toHaveTextContent('Each has its own')
    expect(card).not.toHaveTextContent('Elsewhere')
  })
})
