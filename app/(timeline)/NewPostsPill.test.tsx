/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import {
  NewPostsPill,
  TimelineScrollToTopButton,
  createUnseenAboveStore
} from './NewPostsPill'

describe('createUnseenAboveStore', () => {
  let originalRect: typeof HTMLElement.prototype.getBoundingClientRect
  // Where each feed row's top sits on screen, by its row id attribute.
  let rowTops: Record<string, number>

  const renderRows = (rows: string[][]) => {
    document.body.innerHTML = rows
      .map((ids) => `<div data-row-status-ids="${ids.join(' ')}"></div>`)
      .join('')
  }

  beforeEach(() => {
    originalRect = HTMLElement.prototype.getBoundingClientRect
    rowTops = {}
    HTMLElement.prototype.getBoundingClientRect = function () {
      const top = rowTops[this.getAttribute('data-row-status-ids') ?? ''] ?? 0
      return { top, bottom: top + 100 } as DOMRect
    }
  })

  afterEach(() => {
    cleanup()
    HTMLElement.prototype.getBoundingClientRect = originalRect
    document.body.innerHTML = ''
  })

  it('counts every new post of a thread row that is above the screen', () => {
    // A thread row shows its root first but sits where its newest reply is.
    renderRows([['root', 'reply-new'], ['new-b'], ['old']])
    rowTops = { 'root reply-new': -500, 'new-b': -200, old: 100 }
    const store = createUnseenAboveStore()
    store.add(['reply-new', 'new-b'])

    store.recount()
    expect(store.getCount()).toBe(2)

    rowTops = { 'root reply-new': -150, 'new-b': 150, old: 450 }
    store.recount()
    expect(store.getCount()).toBe(1)

    rowTops = { 'root reply-new': 0, 'new-b': 300, old: 600 }
    store.recount()
    expect(store.getCount()).toBe(0)
  })

  it('forgets a post once it has been on screen, even when it scrolls back above', () => {
    renderRows([['new-a'], ['old']])
    rowTops = { 'new-a': 120, old: 400 }
    const store = createUnseenAboveStore()
    store.add(['new-a'])
    store.recount()
    expect(store.getCount()).toBe(0)

    rowTops = { 'new-a': -400, old: -100 }
    store.recount()
    expect(store.getCount()).toBe(0)
  })

  it('keeps the count while no rows are rendered and notifies only on change', () => {
    const store = createUnseenAboveStore()
    const listener = vi.fn()
    store.subscribe(listener)

    renderRows([['new-a'], ['old']])
    rowTops = { 'new-a': -300, old: 100 }
    store.add(['new-a'])
    store.recount()
    expect(store.getCount()).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)

    document.body.innerHTML = ''
    store.recount()
    store.recount()
    expect(store.getCount()).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)

    store.clear()
    expect(store.getCount()).toBe(0)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('NewPostsPill', () => {
  it('renders nothing when total is 0 and isScrolledDown is false', () => {
    const store = createUnseenAboveStore()
    const { container } = render(
      <NewPostsPill
        store={store}
        polledCount={0}
        isScrolledDown={false}
        onJump={vi.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders "Back to top" when total is 0 and isScrolledDown is true, and invokes onJump on click', () => {
    const store = createUnseenAboveStore()
    const onJump = vi.fn()
    render(
      <NewPostsPill
        store={store}
        polledCount={0}
        isScrolledDown={true}
        onJump={onJump}
      />
    )
    const button = screen.getByRole('button', { name: 'Back to top' })
    expect(button).toBeInTheDocument()
    expect(button).not.toHaveAttribute('aria-busy')
    fireEvent.click(button)
    expect(onJump).toHaveBeenCalledTimes(1)
  })

  it('sets aria-busy="true" on "Back to top" when isScrolledDown and isRefreshing are true', () => {
    const store = createUnseenAboveStore()
    render(
      <NewPostsPill
        store={store}
        polledCount={0}
        isScrolledDown={true}
        isRefreshing={true}
        onJump={vi.fn()}
      />
    )
    const button = screen.getByRole('button', { name: 'Back to top' })
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('renders "2 new posts" when total > 0 even if isScrolledDown is true', () => {
    const store = createUnseenAboveStore()
    render(
      <NewPostsPill
        store={store}
        polledCount={2}
        isScrolledDown={true}
        isRefreshing={true}
        onJump={vi.fn()}
      />
    )
    expect(
      screen.getByRole('button', { name: '2 new posts' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Back to top' })
    ).not.toBeInTheDocument()
  })

  it('renders plus label when hasMorePolled is true', () => {
    const store = createUnseenAboveStore()
    const { rerender } = render(
      <NewPostsPill
        store={store}
        polledCount={20}
        hasMorePolled={true}
        isScrolledDown={false}
        onJump={vi.fn()}
      />
    )
    expect(
      screen.getByRole('button', { name: '20+ new posts' })
    ).toBeInTheDocument()

    rerender(
      <NewPostsPill
        store={store}
        polledCount={1}
        hasMorePolled={true}
        isScrolledDown={false}
        onJump={vi.fn()}
      />
    )
    expect(
      screen.getByRole('button', { name: '1+ new posts' })
    ).toBeInTheDocument()
  })
})

describe('TimelineScrollToTopButton', () => {
  it('hides the floating Scroll to top button when isScrolledDown is true (so the header pill takes over)', () => {
    const store = createUnseenAboveStore()
    const originalScrollY = window.scrollY
    Object.defineProperty(window, 'scrollY', {
      value: 500,
      configurable: true,
      writable: true
    })

    try {
      const { rerender } = render(
        <TimelineScrollToTopButton
          store={store}
          polledCount={0}
          isScrolledDown={false}
          isLoadMoreVisible={false}
        />
      )
      expect(
        screen.getByRole('button', { name: 'Scroll to top' })
      ).toBeInTheDocument()

      rerender(
        <TimelineScrollToTopButton
          store={store}
          polledCount={0}
          isScrolledDown={true}
          isLoadMoreVisible={false}
        />
      )
      expect(
        screen.queryByRole('button', { name: 'Scroll to top' })
      ).not.toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'scrollY', {
        value: originalScrollY,
        configurable: true,
        writable: true
      })
    }
  })
})
