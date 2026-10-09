/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'

import Loading from './loading'

describe('album loading', () => {
  it('announces itself as busy, without the profile banner or avatar', () => {
    const { container } = render(<Loading />)

    expect(screen.getByText('Loading album')).toBeInTheDocument()
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByLabelText('Loading profile')).not.toBeInTheDocument()
  })

  it('draws every placeholder with the shimmer utility', () => {
    const { container } = render(<Loading />)

    const placeholders = container.querySelectorAll('[aria-hidden="true"]')
    expect(placeholders.length).toBeGreaterThan(0)
    for (const leaf of container.querySelectorAll('div:not(:has(div))')) {
      expect(leaf).toHaveClass('skeleton')
    }
  })

  it('draws the Back placeholder as tall as the loaded Back link, so the row does not grow', () => {
    const { container } = render(<Loading />)

    // BackLink is `max-md:min-h-11` below `md` and 32px from there up.
    const back = container.querySelector('[aria-busy] > .skeleton.w-28')
    expect(back).toHaveClass('h-8', 'max-md:h-11')
  })

  it('keeps the signed-in mobile bar and desktop padding of the loaded page', () => {
    const { container } = render(
      <MobileNavigationProvider>
        <Loading />
      </MobileNavigationProvider>
    )

    // The bar (menu button, a placeholder for the title) is there from the
    // start, before the album arrives, so it does not pop in.
    const bar = container.querySelector('[data-mobile-compact-header]')
    expect(bar).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Open navigation' })
    ).toBeInTheDocument()
    expect(bar?.querySelector('.skeleton')).toBeInTheDocument()
    expect(bar?.nextElementSibling).toHaveAttribute('aria-busy', 'true')
    // The loaded page's `md:pt-8`, dropped in the public shell.
    expect(bar?.nextElementSibling).toHaveClass(
      'md:pt-8',
      'group-data-[shell=public]/shell:md:pt-0'
    )
  })
})
