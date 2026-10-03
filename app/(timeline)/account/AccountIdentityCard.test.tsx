/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { AccountIdentityCard } from './AccountIdentityCard'

describe('AccountIdentityCard', () => {
  it('shows the account name as the heading and the email beneath it', () => {
    render(
      <AccountIdentityCard
        name="Ride"
        email="rider@example.com"
        iconUrl={null}
      />
    )

    expect(screen.getByText('Ride')).toBeInTheDocument()
    expect(screen.getByText('rider@example.com')).toBeInTheDocument()
  })

  it('falls back to the email as the heading and renders it once when there is no name', () => {
    render(
      <AccountIdentityCard
        name={null}
        email="rider@example.com"
        iconUrl={null}
      />
    )

    // No distinct name -> email is the heading and the secondary line is
    // suppressed so it is never shown twice.
    expect(screen.getAllByText('rider@example.com')).toHaveLength(1)
  })

  it('treats a name that equals the email case-insensitively as no name', () => {
    render(
      <AccountIdentityCard
        name="Rider@Example.com"
        email="rider@example.com"
        iconUrl={null}
      />
    )

    expect(screen.getAllByText(/rider@example\.com/i)).toHaveLength(1)
  })

  it('derives a Unicode-safe avatar initial from the display name', () => {
    render(
      <AccountIdentityCard
        name="🦊 Ranger"
        email="fox@example.com"
        iconUrl={null}
      />
    )

    // The initial is the whole leading code point, not a broken surrogate half.
    expect(screen.getByText('🦊')).toBeInTheDocument()
  })

  it('draws the avatar initial on the neutral monogram tokens, not Tailwind grays', () => {
    const { container } = render(
      <AccountIdentityCard
        name="Ride"
        email="rider@example.com"
        iconUrl={null}
      />
    )

    // Same fill and letter as the sidebar footer's monogram: the skeleton
    // fill, a semibold muted letter, and the input fill in dark.
    const monogram = container.querySelector('[data-slot="avatar-fallback"]')
    expect(monogram).toHaveTextContent('R')
    expect(monogram).toHaveClass(
      'bg-(--skeleton)',
      'font-semibold',
      'text-muted-foreground',
      'dark:bg-input',
      'text-xl'
    )
    expect(monogram?.className).not.toMatch(/gray-/)
  })
})
