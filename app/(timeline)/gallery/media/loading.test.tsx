/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render as baseRender, screen } from '@testing-library/react'
import { ReactElement } from 'react'

import { PageHeaderSectionProvider } from '@/lib/components/page-header'

import Loading from './loading'

// The gallery layout wraps this route in the section provider (and the
// `relative` dropdown wrapper that the actions' absolute placement counts
// on); the provider is the part jsdom needs.
const render = (ui: ReactElement) =>
  baseRender(<PageHeaderSectionProvider>{ui}</PageHeaderSectionProvider>)

// All media's loading screen draws the page's own geometry: no visible
// title or description (the layout's dropdown row is the top of the
// screen), the actions on its line from sm up, the filter row and the
// grid — so nothing moves when the page hydrates.
describe('gallery all media loading', () => {
  it('announces one polite status and marks the screen busy', () => {
    const { container } = render(<Loading />)

    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent(/^Loading/)
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  it('draws no visible title or description of its own', () => {
    const { container } = render(<Loading />)

    // The outline heading the hydrated page brings is already here,
    // screen-reader only.
    expect(screen.getByRole('heading', { name: 'All media' })).toHaveClass(
      'sr-only'
    )
    expect(container.querySelector('h1')).not.toBeInTheDocument()
    // The header row carries nothing but the two action bars.
    const header = screen
      .getByRole('heading', { name: 'All media' })
      .closest('.mb-6') as HTMLElement
    expect(header.querySelectorAll('[data-slot="skeleton-bar"]')).toHaveLength(
      2
    )
  })

  it('places the actions skeleton like the page places its actions', () => {
    render(<Loading />)

    const header = screen
      .getByRole('heading', { name: 'All media' })
      .closest('.mb-6') as HTMLElement
    expect(header).toHaveClass(
      'sm:absolute',
      'sm:right-0',
      'sm:top-0',
      'md:top-4'
    )
    const actions = header.querySelector('[data-slot="skeleton-bar"]')
      ?.parentElement as HTMLElement
    expect(actions).toHaveClass('sm:h-10', 'sm:items-center')
  })

  it('mirrors the filter row at sm+ and keeps the phone bars stacked', () => {
    const { container } = render(<Loading />)

    // sm+: Type, Show and one Filters bar, then the count and Sort in one
    // right-aligned group like the sheet-mode filter bar. Type and Show cap
    // at 240px like the real selects in the sheet-mode host
    // (`w-full sm:max-w-[240px]`); the Filters, count and Sort bars match
    // the real controls' widths (Filters 75px, count text 5.5rem, Sort
    // 213px).
    const smRow = container.querySelector(
      '[data-slot="skeleton-bar"].w-\\[240px\\]'
    )?.parentElement as HTMLElement
    expect(smRow).toHaveClass('hidden', 'sm:flex')
    expect(smRow.querySelectorAll('[data-slot="skeleton-bar"]')).toHaveLength(5)
    expect(
      smRow.querySelectorAll('[data-slot="skeleton-bar"].w-\\[240px\\]')
    ).toHaveLength(2)
    expect(
      smRow.querySelector('[data-slot="skeleton-bar"].w-\\[75px\\]')
    ).toBeInTheDocument()
    const endGroup = smRow.querySelector('.ml-auto') as HTMLElement
    expect(endGroup).toHaveClass('flex', 'items-center', 'gap-2')
    expect(
      endGroup.querySelector('[data-slot="skeleton-bar"].w-\\[5\\.5rem\\]')
    ).toBeInTheDocument()
    expect(
      endGroup.querySelector('[data-slot="skeleton-bar"].w-\\[213px\\]')
    ).toBeInTheDocument()

    // Phones: Type, Show and the Filters button stacked in the row's lead,
    // the compact Sort beside them.
    const phoneLead = container.querySelector(
      '[data-slot="skeleton-bar"].w-full'
    )?.parentElement as HTMLElement
    expect(phoneLead).toHaveClass(
      'flex',
      'min-w-0',
      'flex-wrap',
      'items-center',
      'gap-2'
    )
    expect(
      phoneLead.querySelectorAll('[data-slot="skeleton-bar"].w-full')
    ).toHaveLength(2)
    // The Filters placeholder matches the real button's 75px.
    expect(
      phoneLead.querySelector('[data-slot="skeleton-bar"].w-\\[75px\\]')
    ).toBeInTheDocument()
    const phoneRow = phoneLead.parentElement as HTMLElement
    expect(phoneRow).toHaveClass(
      'flex',
      'items-center',
      'justify-between',
      'gap-2'
    )
    expect(phoneRow.parentElement).toHaveClass(
      'flex',
      'flex-col',
      'gap-2',
      'sm:hidden'
    )

    // The count line a sheet host keeps on phones below the row.
    const countLine = container.querySelector('[data-slot="skeleton-bar"].h-5')
      ?.parentElement as HTMLElement
    expect(countLine).toHaveClass(
      'flex',
      'items-center',
      'justify-between',
      'gap-2',
      'text-sm',
      'sm:hidden'
    )
  })

  it('reserves the first day header’s height directly above the grid', () => {
    const { container } = render(<Loading />)

    const grid = container.querySelector(
      '[data-slot="gallery-grid-skeleton"]'
    ) as HTMLElement
    const section = grid.parentElement as HTMLElement
    // The page’s 1px sentinel plus its py-1.5 row around a text-[15px]
    // line, with the tiles directly below like GalleryGrid’s section.
    const placeholder = section.firstElementChild as HTMLElement
    expect(placeholder).toHaveAttribute('aria-hidden', 'true')
    const [sentinel, headerRow] = Array.from(placeholder.children)
    expect(sentinel).toHaveClass('h-px')
    expect(headerRow).toHaveClass('py-1.5', 'text-[15px]')
    expect(placeholder.nextElementSibling).toBe(grid)
  })
})
