/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react'
import { useRef } from 'react'

import { useScrollOpenedPostIntoView } from './useScrollOpenedPostIntoView'

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
})
