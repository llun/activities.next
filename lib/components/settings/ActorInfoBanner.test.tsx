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

  it('has correct styling classes', () => {
    const { container } = render(
      <ActorInfoBanner actorHandle="@test@domain.com" />
    )

    const banner = container.firstChild as HTMLElement
    expect(banner).toHaveClass(
      'rounded-md',
      'border',
      'border-blue-200',
      'bg-blue-50',
      'p-3'
    )
  })

  it('has dark-mode colours, so it is not a pale block on a dark page', () => {
    const { container } = render(
      <ActorInfoBanner actorHandle="@test@domain.com" />
    )

    const banner = container.firstChild as HTMLElement
    expect(banner).toHaveClass('dark:border-blue-900', 'dark:bg-blue-950/40')
    expect(screen.getByText(/All fitness imports/i)).toHaveClass(
      'dark:text-blue-200'
    )
  })
})
