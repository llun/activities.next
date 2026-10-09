/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import {
  MobileNavigationProvider,
  useMobileNavigation
} from './mobile-navigation-context'
import {
  FLOATING_TRIGGER_SCROLL_IDLE_MS,
  MobileNavigationTrigger
} from './mobile-navigation-trigger'

const StatusProbe = () => {
  const nav = useMobileNavigation()
  return <div data-testid="status-probe">{String(nav?.isOpen)}</div>
}

describe('MobileNavigationTrigger', () => {
  it('renders null outside of MobileNavigationProvider', () => {
    const { container } = render(<MobileNavigationTrigger />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a bar button named "Open navigation" with no count', () => {
    render(
      <MobileNavigationProvider>
        <MobileNavigationTrigger />
      </MobileNavigationProvider>
    )

    const button = screen.getByRole('button', { name: 'Open navigation' })
    expect(button).not.toHaveAttribute('data-floating-nav-trigger')
    expect(button.textContent).toBe('')
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

  describe('floating variant while the page scrolls', () => {
    const renderFloating = () =>
      render(
        <MobileNavigationProvider>
          <MobileNavigationTrigger variant="floating" />
          <StatusProbe />
        </MobileNavigationProvider>
      )
    const button = () => screen.getByRole('button', { name: 'Open navigation' })
    const scroll = () => act(() => void fireEvent.scroll(window))

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
      vi.restoreAllMocks()
    })

    it('fades while scrolling and returns once scrolling has been idle', () => {
      renderFloating()
      expect(button()).not.toHaveAttribute('data-scroll-faded')

      scroll()
      expect(button()).toHaveAttribute('data-scroll-faded')

      // Each scroll event restarts the idle wait.
      act(() => {
        vi.advanceTimersByTime(FLOATING_TRIGGER_SCROLL_IDLE_MS - 50)
      })
      scroll()
      act(() => {
        vi.advanceTimersByTime(FLOATING_TRIGGER_SCROLL_IDLE_MS - 50)
      })
      expect(button()).toHaveAttribute('data-scroll-faded')

      act(() => {
        vi.advanceTimersByTime(50)
      })
      expect(button()).not.toHaveAttribute('data-scroll-faded')
    })

    it('stays clickable while faded, and is never faded with the drawer open', () => {
      renderFloating()
      scroll()
      expect(button()).toHaveAttribute('data-scroll-faded')

      fireEvent.click(button())
      expect(screen.getByTestId('status-probe')).toHaveTextContent('true')
      const trigger = document.querySelector(
        '[data-floating-nav-trigger]'
      ) as HTMLElement
      expect(trigger).not.toHaveAttribute('data-scroll-faded')
      scroll()
      expect(trigger).not.toHaveAttribute('data-scroll-faded')
    })

    it('never fades the bar variant', () => {
      render(
        <MobileNavigationProvider>
          <MobileNavigationTrigger />
        </MobileNavigationProvider>
      )
      scroll()
      expect(button()).not.toHaveAttribute('data-scroll-faded')
    })

    it('listens passively and removes its listener and timer on unmount', () => {
      const add = vi.spyOn(window, 'addEventListener')
      const remove = vi.spyOn(window, 'removeEventListener')
      const { unmount } = renderFloating()

      const scrollCall = add.mock.calls.find(([type]) => type === 'scroll')
      expect(scrollCall?.[2]).toEqual({ passive: true })

      scroll()
      unmount()
      expect(remove).toHaveBeenCalledWith('scroll', scrollCall?.[1])
      expect(vi.getTimerCount()).toBe(0)
    })
  })
})
