/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { FC } from 'react'

import {
  MobileNavigationProvider,
  useMobileNavigation
} from './mobile-navigation-context'

const mockPathname = vi.fn(() => '/initial')
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname()
}))

const TestConsumer: FC = () => {
  const nav = useMobileNavigation()
  if (!nav) return <div data-testid="no-nav">No Nav</div>
  return (
    <div>
      <div data-testid="is-open">{String(nav.isOpen)}</div>
      <div data-testid="unread-count">{nav.unreadCount}</div>
      <button onClick={() => nav.setOpen(true)} data-testid="open-btn">
        Open
      </button>
      <button onClick={() => nav.setOpen(false)} data-testid="close-btn">
        Close
      </button>
    </div>
  )
}

describe('MobileNavigationContext', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/initial')
  })

  it('returns null when consumed outside MobileNavigationProvider', () => {
    render(<TestConsumer />)
    expect(screen.getByTestId('no-nav')).toBeInTheDocument()
  })

  it('provides state and allows toggling open state', () => {
    render(
      <MobileNavigationProvider unreadCount={3}>
        <TestConsumer />
      </MobileNavigationProvider>
    )

    expect(screen.getByTestId('is-open')).toHaveTextContent('false')
    expect(screen.getByTestId('unread-count')).toHaveTextContent('3')

    fireEvent.click(screen.getByTestId('open-btn'))
    expect(screen.getByTestId('is-open')).toHaveTextContent('true')

    fireEvent.click(screen.getByTestId('close-btn'))
    expect(screen.getByTestId('is-open')).toHaveTextContent('false')
  })

  it('automatically closes when pathname changes', () => {
    const { rerender } = render(
      <MobileNavigationProvider>
        <TestConsumer />
      </MobileNavigationProvider>
    )

    fireEvent.click(screen.getByTestId('open-btn'))
    expect(screen.getByTestId('is-open')).toHaveTextContent('true')

    // Simulate route navigation
    mockPathname.mockReturnValue('/different-route')
    rerender(
      <MobileNavigationProvider>
        <TestConsumer />
      </MobileNavigationProvider>
    )

    expect(screen.getByTestId('is-open')).toHaveTextContent('false')
  })

  it('automatically closes when viewport matches min-width 768px', () => {
    let changeHandler: ((e: { matches: boolean }) => void) | null = null

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(
        (event: string, handler: (e: { matches: boolean }) => void) => {
          if (event === 'change') changeHandler = handler
        }
      ),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))

    render(
      <MobileNavigationProvider>
        <TestConsumer />
      </MobileNavigationProvider>
    )

    fireEvent.click(screen.getByTestId('open-btn'))
    expect(screen.getByTestId('is-open')).toHaveTextContent('true')

    act(() => {
      changeHandler?.({ matches: true })
    })

    expect(screen.getByTestId('is-open')).toHaveTextContent('false')
  })
})
