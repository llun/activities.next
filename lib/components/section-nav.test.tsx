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
  { items: [{ name: 'Last', url: '/s/last', icon: null }] }
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
})

describe('SectionIndex', () => {
  it('lists headed groups, then the footer, then plain runs, without rail-only groups', () => {
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
})
