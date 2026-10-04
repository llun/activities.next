/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'

import { ActorRedirectCard } from './ActorRedirectCard'

describe('ActorRedirectCard', () => {
  it('renders the redirect card with host, target link, and actor handle', () => {
    render(
      <ActorRedirectCard
        host="llun.social"
        targetUrl="https://pouet.chapril.org/@clairenony"
        domain="pouet.chapril.org"
        username="clairenony"
      />
    )

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'You are leaving llun.social'
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText('If you trust this link, click it to continue.')
    ).toBeInTheDocument()

    const buttonLink = screen.getByRole('link', {
      name: /continue to pouet\.chapril\.org/i
    })
    expect(buttonLink).toHaveAttribute(
      'href',
      'https://pouet.chapril.org/@clairenony'
    )
    expect(buttonLink).toHaveAttribute('rel', 'noopener noreferrer')

    const rawLink = screen.getByRole('link', {
      name: 'https://pouet.chapril.org/@clairenony'
    })
    expect(rawLink).toHaveAttribute(
      'href',
      'https://pouet.chapril.org/@clairenony'
    )

    expect(
      screen.getByText('@clairenony@pouet.chapril.org · external profile')
    ).toBeInTheDocument()
  })

  it('names the page in the mobile compact bar without adding a second heading', () => {
    const { container } = render(
      <MobileNavigationProvider>
        <ActorRedirectCard
          host="llun.social"
          targetUrl="https://pouet.chapril.org/@clairenony"
          domain="pouet.chapril.org"
          username="clairenony"
          pageTitle="Followers"
        />
      </MobileNavigationProvider>
    )

    const bar = container.querySelector(
      '[data-mobile-compact-header]'
    ) as HTMLElement
    expect(within(bar).getByText('Followers').tagName).toBe('P')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})
