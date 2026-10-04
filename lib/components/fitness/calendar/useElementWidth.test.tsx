/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'
import { FC } from 'react'

import { useElementWidth } from './useElementWidth'

let deliver: ((width: number) => void) | null = null
let disconnected = 0

class ResizeObserverStub {
  constructor(
    private readonly callback: (entries: ResizeObserverEntry[]) => void
  ) {}

  observe(target: Element) {
    deliver = (width: number) => {
      this.callback([
        {
          target,
          contentRect: { width } as DOMRectReadOnly
        } as ResizeObserverEntry
      ])
    }
  }

  unobserve() {}

  disconnect() {
    disconnected += 1
  }
}

const Probe: FC = () => {
  const [ref, width] = useElementWidth()
  return (
    <div ref={ref} data-testid="box">
      {width === null ? 'unknown' : width}
    </div>
  )
}

const text = () => screen.getByTestId('box').textContent

describe('useElementWidth', () => {
  beforeEach(() => {
    deliver = null
    disconnected = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reports null where nothing can be measured (server, jsdom)', () => {
    render(<Probe />)

    expect(text()).toBe('unknown')
  })

  it('measures at mount, before the observer delivers anything', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 908.4
    } as DOMRect)

    render(<Probe />)

    expect(text()).toBe('908')
  })

  it('follows the observer and rounds to whole pixels', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    render(<Probe />)

    act(() => deliver?.(357.6))

    expect(text()).toBe('358')
  })

  it('ignores a zero width: the element was never laid out, not empty', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    render(<Probe />)
    act(() => deliver?.(730))

    act(() => deliver?.(0))

    expect(text()).toBe('730')
  })

  it('stops observing on unmount', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    const { unmount } = render(<Probe />)

    unmount()

    expect(disconnected).toBe(1)
  })
})
