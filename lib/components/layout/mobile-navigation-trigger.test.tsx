/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import {
  MobileNavigationProvider,
  useMobileNavigation
} from './mobile-navigation-context'
import { MobileNavigationTrigger } from './mobile-navigation-trigger'

const StatusProbe = () => {
  const nav = useMobileNavigation()
  return <div data-testid="status-probe">{String(nav?.isOpen)}</div>
}

describe('MobileNavigationTrigger', () => {
  it('renders null outside of MobileNavigationProvider', () => {
    const { container } = render(<MobileNavigationTrigger />)
    expect(container.firstChild).toBeNull()
  })

  it('renders with "Open navigation" label when unreadCount is 0', () => {
    render(
      <MobileNavigationProvider unreadCount={0}>
        <MobileNavigationTrigger />
      </MobileNavigationProvider>
    )

    const button = screen.getByRole('button', { name: 'Open navigation' })
    expect(button).toBeInTheDocument()
    expect(button).toHaveClass('md:hidden')
    expect(screen.queryByText(/^[0-9]+$/)).not.toBeInTheDocument()
  })

  it('renders with singular accessible label and hidden badge when unreadCount is 1', () => {
    render(
      <MobileNavigationProvider unreadCount={1}>
        <MobileNavigationTrigger />
      </MobileNavigationProvider>
    )

    const button = screen.getByRole('button', {
      name: 'Open navigation, 1 unread notification'
    })
    expect(button).toBeInTheDocument()

    const badge = screen.getByText('1')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders with plural accessible label and hidden badge when unreadCount is > 1', () => {
    render(
      <MobileNavigationProvider unreadCount={8}>
        <MobileNavigationTrigger />
      </MobileNavigationProvider>
    )

    const button = screen.getByRole('button', {
      name: 'Open navigation, 8 unread notifications'
    })
    expect(button).toBeInTheDocument()

    const badge = screen.getByText('8')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('aria-hidden', 'true')
  })

  it('opens navigation drawer when clicked', () => {
    render(
      <MobileNavigationProvider>
        <MobileNavigationTrigger />
        <StatusProbe />
      </MobileNavigationProvider>
    )

    expect(screen.getByTestId('status-probe')).toHaveTextContent('false')
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(screen.getByTestId('status-probe')).toHaveTextContent('true')
  })
})
