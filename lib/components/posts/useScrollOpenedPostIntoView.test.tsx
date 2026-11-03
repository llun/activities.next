/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react'
import { useRef } from 'react'

import {
  OPENED_POST_LANDED_KEY,
  useScrollOpenedPostIntoView
} from './useScrollOpenedPostIntoView'

const Opened = ({
  hasPostsAbove,
  inRun = false
}: {
  hasPostsAbove: boolean
  inRun?: boolean
}) => {
  const ref = useRef<HTMLDivElement | null>(null)
  useScrollOpenedPostIntoView(() => ref.current, hasPostsAbove)
  return (
    <div ref={ref} data-testid="opened">
      {inRun ? (
        <div data-testid="self-thread-run">
          <div data-testid="part-1">Part 1</div>
          <div data-testid="part-2" aria-current="location">
            Part 2
          </div>
        </div>
      ) : (
        <div aria-current="location">The post</div>
      )}
    </div>
  )
}

describe('useScrollOpenedPostIntoView', () => {
  const scrollIntoView = vi.fn()
  beforeEach(() => {
    scrollIntoView.mockReset()
    Element.prototype.scrollIntoView = scrollIntoView
  })
  afterEach(() => {
    cleanup()
    window.history.replaceState(null, '', '/')
    window.history.scrollRestoration = 'auto'
  })

  it('scrolls the opened post to the top, instantly, once', () => {
    const { getByTestId, rerender } = render(<Opened hasPostsAbove />)
    rerender(<Opened hasPostsAbove />)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'start',
      behavior: 'auto'
    })
    expect(scrollIntoView.mock.contexts[0]).toBe(getByTestId('opened'))
  })

  it("targets the opened part of a run, so the run's earlier parts stay above", () => {
    const { getByTestId } = render(<Opened hasPostsAbove inRun />)
    expect(scrollIntoView.mock.contexts[0]).toBe(getByTestId('part-2'))
  })

  it('does nothing without posts above, or when they arrive later', () => {
    const { rerender } = render(<Opened hasPostsAbove={false} />)
    rerender(<Opened hasPostsAbove />)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('leaves a #anchor to the browser', () => {
    window.history.replaceState(null, '', '/#reply-1')
    render(<Opened hasPostsAbove />)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('marks the history entry once it has landed, keeping its state', () => {
    window.history.replaceState({ router: 'kept' }, '')
    render(<Opened hasPostsAbove />)
    expect(window.history.state).toEqual({
      router: 'kept',
      [OPENED_POST_LANDED_KEY]: true
    })
  })

  it('leaves Back, Forward and reload to the browser once the entry has landed', () => {
    window.history.scrollRestoration = 'auto'
    window.history.replaceState({ [OPENED_POST_LANDED_KEY]: true }, '')
    render(<Opened hasPostsAbove />)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('lands again under manual scroll restoration, which restores nothing', () => {
    window.history.scrollRestoration = 'manual'
    window.history.replaceState({ [OPENED_POST_LANDED_KEY]: true }, '')
    render(<Opened hasPostsAbove />)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('puts the mark back after a router write drops it, on the same page', () => {
    const { rerender } = render(<Opened hasPostsAbove />)
    // What the router's history write after `router.refresh()` leaves.
    window.history.replaceState({ __NA: true }, '')
    rerender(<Opened hasPostsAbove />)
    expect(window.history.state).toEqual({
      __NA: true,
      [OPENED_POST_LANDED_KEY]: true
    })
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('puts the mark back on pagehide', () => {
    render(<Opened hasPostsAbove />)
    window.history.replaceState({ __NA: true }, '')
    window.dispatchEvent(new Event('pagehide'))
    expect(window.history.state).toEqual({
      __NA: true,
      [OPENED_POST_LANDED_KEY]: true
    })
  })

  it('leaves another page’s entry unmarked', () => {
    const { rerender } = render(<Opened hasPostsAbove />)
    window.history.replaceState({ __NA: true }, '', '/elsewhere')
    rerender(<Opened hasPostsAbove />)
    window.dispatchEvent(new Event('pagehide'))
    expect(window.history.state).toEqual({ __NA: true })
  })

  it('still lands when history cannot be written', () => {
    const replaceState = vi
      .spyOn(window.history, 'replaceState')
      .mockImplementation(() => {
        throw new Error('SecurityError')
      })
    try {
      render(<Opened hasPostsAbove />)
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
    } finally {
      replaceState.mockRestore()
    }
  })
})
