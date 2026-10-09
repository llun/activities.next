/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ActorInfoBanner } from './ActorInfoBanner'

describe('ActorInfoBanner', () => {
  it('renders actor handle correctly', () => {
    render(<ActorInfoBanner actorHandle="@llun@activities.local" />)

    expect(
      screen.getByText(/All fitness imports will be saved to/i)
    ).toBeInTheDocument()
    expect(screen.getByText('@llun@activities.local')).toBeInTheDocument()
  })

  it('renders with different handle format', () => {
    render(<ActorInfoBanner actorHandle="@user@example.com" />)

    expect(screen.getByText('@user@example.com')).toBeInTheDocument()
  })

  it('is an info Alert, a polite status with the info rule', () => {
    render(<ActorInfoBanner actorHandle="@test@domain.com" />)

    const banner = screen.getByRole('status')
    expect(banner).toHaveAttribute('data-tone', 'info')
    expect(banner).toHaveClass('border-l-4', 'border-l-info')
  })

  it('uses theme tokens only, so it follows dark mode', () => {
    const { container } = render(
      <ActorInfoBanner actorHandle="@test@domain.com" />
    )

    expect(container.innerHTML).not.toMatch(
      /(bg|text|border)-(red|green|amber|yellow|blue)-\d/
    )
  })
})
