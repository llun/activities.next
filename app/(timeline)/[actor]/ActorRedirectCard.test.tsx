/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

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
})
