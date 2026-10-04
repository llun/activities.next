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

  it('stacks the floating variant above the page at the 16px safe-area inset', () => {
    render(
      <MobileNavigationProvider>
        <MobileNavigationTrigger variant="floating" />
      </MobileNavigationProvider>
    )

    const button = screen.getByRole('button', { name: 'Open navigation' })
    expect(button).toHaveClass(
      'z-30',
      'top-[calc(env(safe-area-inset-top,0px)+16px)]',
      'left-[calc(env(safe-area-inset-left,0px)+16px)]'
    )
  })

  it('keeps the orange focus ring and adds a foreground outline to the floating variant', () => {
    render(
      <MobileNavigationProvider>
        <MobileNavigationTrigger variant="floating" />
      </MobileNavigationProvider>
    )

    // The ring alone vanishes over the orange profile cover, so a 1px
    // foreground outline sits outside it. `outline-1` carries the solid style
    // (`cn` would merge a bare `outline` into it), and `outline-hidden` must
    // not be on the button: it would set the style to none and cancel it.
    const button = screen.getByRole('button', { name: 'Open navigation' })
    expect(button).toHaveClass(
      'focus-visible:ring-2',
      'focus-visible:ring-ring',
      'focus-visible:ring-offset-2',
      'focus-visible:ring-offset-background',
      'focus-visible:outline-1',
      'focus-visible:outline-offset-4',
      'focus-visible:outline-foreground'
    )
    expect(button).not.toHaveClass('focus-visible:outline-hidden')
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
      expect(button()).not.toHaveClass('opacity-40')

      scroll()
      expect(button()).toHaveAttribute('data-scroll-faded')
      expect(button()).toHaveClass('opacity-40')

      // Each scroll event restarts the idle wait.
      act(() => {
        vi.advanceTimersByTime(FLOATING_TRIGGER_SCROLL_IDLE_MS - 50)
      })
      scroll()
      act(() => {
        vi.advanceTimersByTime(FLOATING_TRIGGER_SCROLL_IDLE_MS - 50)
      })
      expect(button()).toHaveClass('opacity-40')

      act(() => {
        vi.advanceTimersByTime(50)
      })
      expect(button()).not.toHaveAttribute('data-scroll-faded')
      expect(button()).not.toHaveClass('opacity-40')
    })

    it('stays clickable while faded, and is never faded with the drawer open', () => {
      renderFloating()
      scroll()
      expect(button()).toHaveClass('opacity-40')
      expect(button()).not.toHaveClass('pointer-events-none')

      fireEvent.click(button())
      expect(screen.getByTestId('status-probe')).toHaveTextContent('true')
      const trigger = document.querySelector(
        '[data-floating-nav-trigger]'
      ) as HTMLElement
      expect(trigger).not.toHaveClass('opacity-40')
      scroll()
      expect(trigger).not.toHaveClass('opacity-40')
    })

    it('restores full opacity for keyboard focus and drops the transition for reduced motion', () => {
      renderFloating()
      // A faded utility without a variant loses to `focus-visible:` ones.
      expect(button()).toHaveClass(
        'focus-visible:opacity-100',
        'transition-opacity',
        'motion-reduce:transition-none'
      )
    })

    it('never fades the bar variant', () => {
      render(
        <MobileNavigationProvider>
          <MobileNavigationTrigger />
        </MobileNavigationProvider>
      )
      scroll()
      expect(button()).not.toHaveAttribute('data-scroll-faded')
      expect(button()).not.toHaveClass('opacity-40')
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
