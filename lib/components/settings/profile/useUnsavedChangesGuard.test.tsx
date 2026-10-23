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

// jsdom has no Navigation API: a small stand-in that fires the `navigate`
// event of a traversal before anything changes, as browsers do, and reports
// whether a listener cancelled it.
interface TraverseOptions {
  url?: string
  cancelable?: boolean
  sameDocument?: boolean
  navigationType?: string
}
class FakeNavigation extends EventTarget {
  committed = true
  traverseTo = vi.fn((key: string) => {
    this.navigate({ key })
    return {
      committed: this.committed
        ? Promise.resolve()
        : Promise.reject(new Error('InvalidStateError')),
      finished: Promise.resolve()
    }
  })
  /** Returns true when the traversal went ahead, false when it was cancelled. */
  navigate({
    key = 'entry-1',
    url = 'http://localhost/settings',
    cancelable = true,
    sameDocument = true,
    navigationType = 'traverse'
  }: TraverseOptions & { key?: string } = {}) {
    const event = new Event('navigate', { cancelable })
    Object.assign(event, {
      navigationType,
      destination: { key, url, sameDocument }
    })
    return this.dispatchEvent(event)
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

    beforeEach(() => {
      navigation = new FakeNavigation()
      Object.defineProperty(window, 'navigation', {
        value: navigation,
        configurable: true
      })
    })
    afterEach(() => {
      Reflect.deleteProperty(window, 'navigation')
    })

    it('cancels Back before anything changes and asks', () => {
      render(<Harness dirty />)

      let went = true
      act(() => {
        went = navigation.navigate()
      })

      expect(went).toBe(false)
      expect(screen.getByRole('status')).toHaveTextContent('history')
      expect(navigation.traverseTo).not.toHaveBeenCalled()
    })

    it('replays the held step with traverseTo on discard, once', () => {
      render(<Harness dirty />)
      act(() => {
        navigation.navigate({ key: 'entry-7' })
      })

      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

      expect(navigation.traverseTo).toHaveBeenCalledExactlyOnceWith('entry-7')
      expect(screen.getByRole('status')).toHaveTextContent('none')
      // The replay was let through, and the guard is spent: the next Back asks.
      let went = true
      act(() => {
        went = navigation.navigate()
      })
      expect(went).toBe(false)
    })

    it('replays Forward the same way', () => {
      render(<Harness dirty />)
      act(() => {
        navigation.navigate({ key: 'entry-9', url: 'http://localhost/later' })
      })

      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

      expect(navigation.traverseTo).toHaveBeenCalledExactlyOnceWith('entry-9')
    })

    it('keeps the latest step when Back is pressed again while asking', () => {
      render(<Harness dirty />)
      act(() => {
        navigation.navigate({ key: 'entry-2' })
        navigation.navigate({ key: 'entry-1' })
      })

      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

      expect(navigation.traverseTo).toHaveBeenCalledExactlyOnceWith('entry-1')
    })

    it('stays on the page on keep editing and still asks next time', () => {
      render(<Harness dirty />)
      act(() => {
        navigation.navigate()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Keep' }))

      expect(screen.getByRole('status')).toHaveTextContent('none')
      expect(navigation.traverseTo).not.toHaveBeenCalled()
      let went = true
      act(() => {
        went = navigation.navigate()
      })
      expect(went).toBe(false)
    })

    it('lets Back and Forward through when clean', () => {
      render(<Harness dirty={false} />)

      expect(navigation.navigate()).toBe(true)
      expect(navigation.navigate({ key: 'entry-3' })).toBe(true)
      expect(screen.getByRole('status')).toHaveTextContent('none')
    })

    it('never asks for a traversal that stays on this path', () => {
      render(<Harness dirty />)

      expect(
        navigation.navigate({ url: 'http://localhost/?switched=1#top' })
      ).toBe(true)
      expect(screen.getByRole('status')).toHaveTextContent('none')
    })

    it('leaves what it cannot or should not hold to beforeunload', () => {
      render(<Harness dirty />)

      // The browser does not let the page cancel it.
      expect(navigation.navigate({ cancelable: false })).toBe(true)
      // Another document: beforeunload asks.
      expect(navigation.navigate({ sameDocument: false })).toBe(true)
      // Not a Back or Forward.
      expect(navigation.navigate({ navigationType: 'push' })).toBe(true)
      expect(screen.getByRole('status')).toHaveTextContent('none')
    })

    it('stays and asks again when the held entry is gone', async () => {
      render(<Harness dirty />)
      act(() => {
        navigation.navigate()
      })
      navigation.committed = false

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
      })

      let went = true
      act(() => {
        went = navigation.navigate()
      })
      expect(went).toBe(false)
    })

    it('stops listening on unmount', () => {
      const { unmount } = render(<Harness dirty />)
      unmount()

      expect(navigation.navigate()).toBe(true)
    })
  })

  describe('allowNavigation', () => {
    let navigation: FakeNavigation

    beforeEach(() => {
      vi.useFakeTimers()
      navigation = new FakeNavigation()
      Object.defineProperty(window, 'navigation', {
        value: navigation,
        configurable: true
      })
    })
    afterEach(() => {
      vi.useRealTimers()
      Reflect.deleteProperty(window, 'navigation')
    })

    it('ends with the first navigation to another path', () => {
      render(<Harness dirty />)
      fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

      expect(navigation.navigate({ navigationType: 'push' })).toBe(true)

      expect(unload()).toBe(true)
      expect(
        fireEvent.click(screen.getByRole('link', { name: 'In app' }))
      ).toBe(false)
    })

    it('ends after a while when no navigation came', () => {
      render(<Harness dirty />)
      fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
      expect(unload()).toBe(false)

      act(() => {
        vi.advanceTimersByTime(6000)
      })

      expect(unload()).toBe(true)
    })

    it('is not spent by a navigation that stays on this path', () => {
      render(<Harness dirty />)
      fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

      navigation.navigate({
        navigationType: 'replace',
        url: 'http://localhost/?a=1'
      })

      expect(unload()).toBe(false)
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

  it('stands down while navigation is allowed', () => {
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
