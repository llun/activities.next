/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading, { StatusLoading } from './loading'

describe('[status] loading', () => {
  it('renders loading post skeleton with accessibility attributes', () => {
    render(<Loading />)

    const loadingRegion = screen.getByLabelText('Loading post')
    expect(loadingRegion).toBeInTheDocument()
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true')
  })

  it('exports StatusLoading named component', () => {
    render(<StatusLoading />)

    expect(screen.getByLabelText('Loading post')).toBeInTheDocument()
  })

  it('renders every placeholder with the shimmer skeleton utility', () => {
    // jsdom paints no CSS so classes are the observable; every leaf <div> in
    // this skeleton is a placeholder (containers always hold further divs),
    // and a bare `length > 0` missed both a partial strip and a future
    // unstyled row; the `.skeleton` definition itself is guarded by
    // app/globals.skeleton.test.ts.
    const { container } = render(<Loading />)
    const leaves = Array.from(container.querySelectorAll('div')).filter(
      (el) => el.children.length === 0
    )
    expect(leaves.length).toBeGreaterThan(0)
    leaves.forEach((el) => expect(el).toHaveClass('skeleton'))
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('draws the mobile Back row skeleton where the loaded row puts it', () => {
    const { container } = render(<Loading />)

    // Same 16px gutter and 16px arrow as the loaded Header, so the arrow
    // does not shift when the post arrives.
    const arrow = container.querySelector('.md\\:hidden > .size-4')
    expect(arrow).toHaveClass('skeleton')
    expect(arrow?.parentElement).toHaveClass('h-11', 'gap-2')
    expect(arrow?.parentElement).not.toHaveClass('px-1')
    expect(arrow?.parentElement?.parentElement).toHaveClass('max-md:px-4')
  })

  it('applies top margin only from md up, sitting flush on mobile', () => {
    const { container } = render(<Loading />)
    const card = container.firstElementChild as HTMLElement

    expect(card).toHaveClass('md:mt-4')
    expect(card).not.toHaveClass('mt-4')
    // Logged out the card takes no margin of its own at any width: PublicShell's
    // py-6 is the gap under PublicTopBar, as it is on the loaded page.
    expect(card).toHaveClass('group-data-[shell=public]/shell:mt-0')
    expect(card).not.toHaveClass('group-data-[shell=public]/shell:max-md:-mt-6')
    expect(card).not.toHaveClass('max-md:-mt-6')
  })

  it('is an inset card below md when logged out, like the loaded thread card', () => {
    const { container } = render(<Loading />)
    const card = container.firstElementChild as HTMLElement

    // Signed in it stays the full-bleed feed surface…
    expect(card).toHaveClass(
      'max-md:mx-[calc(50%_-_50vw)]',
      'max-md:rounded-none',
      'max-md:border-0',
      'max-md:shadow-none'
    )
    // …and the public shell's variants (higher specificity) undo each of those
    // below md: the page's gutter back, the card's radius, border and shadow.
    expect(card).toHaveClass(
      'group-data-[shell=public]/shell:max-md:mx-0',
      'group-data-[shell=public]/shell:max-md:rounded-2xl',
      'group-data-[shell=public]/shell:max-md:border',
      'group-data-[shell=public]/shell:max-md:shadow-sm'
    )
  })
})
