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

  it('renders a 44px bar button named "Open navigation" with no count', () => {
    render(
      <MobileNavigationProvider>
        <MobileNavigationTrigger />
      </MobileNavigationProvider>
    )

    const button = screen.getByRole('button', { name: 'Open navigation' })
    expect(button).toHaveClass('md:hidden', 'h-11', 'w-11')
    expect(button).not.toHaveAttribute('data-floating-nav-trigger')
    expect(button.textContent).toBe('')
  })

  it('renders the floating variant as a fixed circular button with its own surface', () => {
    render(
      <MobileNavigationProvider>
        <MobileNavigationTrigger variant="floating" />
      </MobileNavigationProvider>
    )

    const button = screen.getByRole('button', { name: 'Open navigation' })
    expect(button).toHaveAttribute('data-floating-nav-trigger')
    // The class list is the contract here: the design's 44px circle, fixed at
    // the 16px inset, solid theme-aware surface with border and shadow, and a
    // visible focus ring.
    expect(button).toHaveClass(
      'fixed',
      'size-11',
      'rounded-full',
      'border',
      'bg-popover',
      'shadow-md',
      'focus-visible:ring-2',
      'md:hidden'
    )
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
