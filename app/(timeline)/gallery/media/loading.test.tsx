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

    // sm+: Type, Show and one Filters bar, with the count and Sort at the
    // row's right end.
    const smRow = container.querySelector('[data-slot="skeleton-bar"].w-64')
      ?.parentElement as HTMLElement
    expect(smRow).toHaveClass('hidden', 'sm:flex')
    expect(smRow.querySelectorAll('[data-slot="skeleton-bar"]')).toHaveLength(5)
    expect(
      smRow.querySelector('[data-slot="skeleton-bar"].ml-auto')
    ).toBeInTheDocument()

    // Phones keep their two full-width bars.
    const phoneRow = container.querySelector(
      '[data-slot="skeleton-bar"].w-full'
    )?.parentElement as HTMLElement
    expect(phoneRow).toHaveClass('sm:hidden')
    expect(
      phoneRow.querySelectorAll('[data-slot="skeleton-bar"]')
    ).toHaveLength(2)
  })
})
