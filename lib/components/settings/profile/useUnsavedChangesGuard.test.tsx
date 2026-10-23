/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { useUnsavedChangesGuard } from './useUnsavedChangesGuard'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const Harness = ({ dirty }: { dirty: boolean }) => {
  const guard = useUnsavedChangesGuard(dirty)
  return (
    <div>
      <a href="/elsewhere?x=1#top">In app</a>
      <a href="https://other.example/page">Outside</a>
      <a href="#section">Same page</a>
      <a href="/">Same path, other query</a>
      <a href="/elsewhere" target="_blank">
        New tab
      </a>
      <a href="/file.zip" download>
        Download
      </a>
      <button type="button" onClick={guard.allowNavigation}>
        Allow
      </button>
      <button type="button" onClick={guard.keepEditing}>
        Keep
      </button>
      <button type="button" onClick={guard.discard}>
        Discard
      </button>
      <output>
        {guard.pendingHref ?? (guard.pending ? 'history' : 'none')}
      </output>
    </div>
  )
}

const unload = () => {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

// jsdom has no Navigation API: a small stand-in that reports the entry change
// before the popstate, as browsers do.
class FakeNavigation extends EventTarget {
  currentEntry = { index: 3 }
  traverse(delta: number) {
    const from = this.currentEntry
    this.currentEntry = { index: from.index + delta }
    const event = new Event('currententrychange')
    Object.assign(event, { from })
    this.dispatchEvent(event)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

describe('useUnsavedChangesGuard', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('same path', () => {
    it('leaves a link to the same path with another query alone', () => {
      window.history.replaceState(null, '', '/?switched=1')
      render(<Harness dirty />)

      expect(
        fireEvent.click(
          screen.getByRole('link', { name: 'Same path, other query' })
        )
      ).toBe(true)
      expect(screen.getByRole('status')).toHaveTextContent('none')
      window.history.replaceState(null, '', '/')
    })

    it('asks again when the person edits after a move that did not leave', () => {
      const { rerender } = render(<Harness dirty />)
      fireEvent.click(screen.getByRole('link', { name: 'In app' }))
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
      // Still here: the page was edited again.
      rerender(<Harness dirty={false} />)
      rerender(<Harness dirty />)

      expect(
        fireEvent.click(screen.getByRole('link', { name: 'In app' }))
      ).toBe(false)
      expect(unload()).toBe(true)
    })
  })

  describe('Back and Forward', () => {
    let navigation: FakeNavigation
    let go: ReturnType<typeof vi.spyOn>
    let nextRouterSawIt: ReturnType<typeof vi.fn>

    beforeEach(() => {
      navigation = new FakeNavigation()
      Object.defineProperty(window, 'navigation', {
        value: navigation,
        configurable: true
      })
      go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
      // Next listens in the bubble phase.
      nextRouterSawIt = vi.fn()
      window.addEventListener('popstate', nextRouterSawIt as EventListener)
    })
    afterEach(() => {
      window.removeEventListener('popstate', nextRouterSawIt as EventListener)
      go.mockRestore()
      Reflect.deleteProperty(window, 'navigation')
    })

    it('holds Back from the router, returns to the entry and asks', () => {
      render(<Harness dirty />)

      act(() => navigation.traverse(-1))

      expect(nextRouterSawIt).not.toHaveBeenCalled()
      expect(go).toHaveBeenCalledWith(1)
      expect(screen.getByRole('status')).toHaveTextContent('history')
    })

    it('does not mistake its own step back for a second press', () => {
      render(<Harness dirty />)
      act(() => navigation.traverse(-1))

      act(() => navigation.traverse(1))

      expect(nextRouterSawIt).not.toHaveBeenCalled()
      expect(go).toHaveBeenCalledTimes(1)
    })

    it('replays Back on discard with the guard off', () => {
      render(<Harness dirty />)
      act(() => navigation.traverse(-1))
      act(() => navigation.traverse(1))
      go.mockClear()

      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

      expect(go).toHaveBeenCalledWith(-1)
      expect(screen.getByRole('status')).toHaveTextContent('none')
      act(() => navigation.traverse(-1))
      expect(nextRouterSawIt).toHaveBeenCalledTimes(1)
    })

    it('replays Forward the same way', () => {
      render(<Harness dirty />)
      act(() => navigation.traverse(1))
      expect(go).toHaveBeenCalledWith(-1)
      act(() => navigation.traverse(-1))

      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

      expect(go).toHaveBeenLastCalledWith(1)
    })

    it('stays on the page on keep editing', () => {
      render(<Harness dirty />)
      act(() => navigation.traverse(-1))
      act(() => navigation.traverse(1))

      fireEvent.click(screen.getByRole('button', { name: 'Keep' }))

      expect(screen.getByRole('status')).toHaveTextContent('none')
      expect(go).toHaveBeenCalledTimes(1)
    })

    it('lets Back through when clean', () => {
      render(<Harness dirty={false} />)

      act(() => navigation.traverse(-1))

      expect(nextRouterSawIt).toHaveBeenCalledTimes(1)
      expect(go).not.toHaveBeenCalled()
    })

    it('stops listening on unmount', () => {
      const { unmount } = render(<Harness dirty />)
      unmount()

      act(() => navigation.traverse(-1))

      expect(nextRouterSawIt).toHaveBeenCalledTimes(1)
    })
  })

  it('holds back an in-app link click while dirty and remembers where it led', () => {
    render(<Harness dirty />)

    const notPrevented = fireEvent.click(
      screen.getByRole('link', { name: 'In app' })
    )

    expect(notPrevented).toBe(false)
    expect(screen.getByRole('status')).toHaveTextContent('/elsewhere?x=1#top')
  })

  it('follows the held-back link on discard, once', () => {
    render(<Harness dirty />)
    fireEvent.click(screen.getByRole('link', { name: 'In app' }))

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(push).toHaveBeenCalledWith('/elsewhere?x=1#top')
    expect(screen.getByRole('status')).toHaveTextContent('none')
  })

  it('forgets the link on keep editing', () => {
    render(<Harness dirty />)
    fireEvent.click(screen.getByRole('link', { name: 'In app' }))

    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))

    expect(screen.getByRole('status')).toHaveTextContent('none')
    expect(push).not.toHaveBeenCalled()
  })

  it('leaves clicks alone when clean', () => {
    render(<Harness dirty={false} />)

    expect(fireEvent.click(screen.getByRole('link', { name: 'In app' }))).toBe(
      true
    )
    expect(unload()).toBe(false)
  })

  it('leaves outside links, same-page links, new tabs and downloads alone', () => {
    render(<Harness dirty />)

    for (const name of ['Outside', 'Same page', 'New tab', 'Download']) {
      expect(fireEvent.click(screen.getByRole('link', { name }))).toBe(true)
    }
    expect(screen.getByRole('status')).toHaveTextContent('none')
  })

  it('leaves modified clicks alone', () => {
    render(<Harness dirty />)
    const link = screen.getByRole('link', { name: 'In app' })

    expect(fireEvent.click(link, { shiftKey: true })).toBe(true)
    expect(fireEvent.click(link, { altKey: true })).toBe(true)
    expect(fireEvent.click(link, { button: 2 })).toBe(true)
  })

  it('asks on beforeunload while dirty only', () => {
    const { rerender } = render(<Harness dirty />)
    expect(unload()).toBe(true)

    rerender(<Harness dirty={false} />)
    expect(unload()).toBe(false)
  })

  it('stands down for good once navigation is allowed', () => {
    render(<Harness dirty />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

    expect(unload()).toBe(false)
    expect(fireEvent.click(screen.getByRole('link', { name: 'In app' }))).toBe(
      true
    )
  })

  it('removes its listeners on unmount', () => {
    const { unmount } = render(<Harness dirty />)
    unmount()

    expect(unload()).toBe(false)
  })
})
