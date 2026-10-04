/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'

import Loading, { ProfileLoading } from './loading'
import { PROFILE_CARD_MOBILE_CLASS } from './profileLayout'

describe('[actor] loading', () => {
  it('renders loading profile skeleton with accessibility attributes', () => {
    render(<Loading />)

    const loadingRegion = screen.getByLabelText('Loading profile')
    expect(loadingRegion).toBeInTheDocument()
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true')
  })

  it('exports ProfileLoading named component', () => {
    render(<ProfileLoading />)

    expect(screen.getByLabelText('Loading profile')).toBeInTheDocument()
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

  it('pads the top only from md up, so the cover sits flush on mobile', () => {
    const { container } = render(<Loading />)
    const root = container.firstElementChild
    expect(root).toHaveClass('md:pt-8')
    expect(root).not.toHaveClass('pt-6')
    expect(root).toHaveClass('group-data-[shell=public]/shell:pt-0')
  })

  it('makes the card full-bleed and flat below md like the signed-in page', () => {
    const { container } = render(
      <MobileNavigationProvider>
        <Loading />
      </MobileNavigationProvider>
    )
    const card = container.querySelector('section')
    PROFILE_CARD_MOBILE_CLASS.split(' ').forEach((token) =>
      expect(card).toHaveClass(token)
    )
    // The page's card drops its shadow below md; the skeleton must too.
    expect(card).toHaveClass('max-md:shadow-none')
  })

  // Logged out (PublicShell provides no mobile navigation) the skeleton is the
  // framed card under the public top bar, as on every width.
  it('keeps the framed card and no menu button when logged out', () => {
    const { container } = render(<Loading />)
    const card = container.querySelector('section')
    PROFILE_CARD_MOBILE_CLASS.split(' ').forEach((token) =>
      expect(card).not.toHaveClass(token)
    )
    expect(card).not.toHaveClass('max-md:shadow-none')
    expect(card).toHaveClass('rounded-2xl', 'border', 'shadow-sm')
    expect(
      container.querySelector('[data-floating-nav-trigger]')
    ).not.toBeInTheDocument()
  })

  it('floats the menu button where the page does', () => {
    const { container } = render(
      <MobileNavigationProvider>
        <Loading />
      </MobileNavigationProvider>
    )

    // The page floats the button over the cover; an in-flow bar variant here
    // would shift the layout when the page replaces the skeleton.
    expect(
      container.querySelector('[data-floating-nav-trigger]')
    ).toBeInTheDocument()
  })
})
