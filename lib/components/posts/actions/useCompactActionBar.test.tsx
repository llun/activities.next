/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'
import { FC } from 'react'

import {
  COMPACT_ACTION_BAR_WIDTH,
  useCompactActionBar
} from './useCompactActionBar'

// A ResizeObserver whose deliveries the test drives, so the width the hook sees
// is the width under test rather than jsdom's (which lays nothing out and
// reports 0 for everything).
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

const Probe: FC<{ threshold?: number }> = ({ threshold }) => {
  const [ref, isCompact] = useCompactActionBar(threshold)
  return (
    <div ref={ref} data-testid="bar">
      {isCompact ? 'compact' : 'wide'}
    </div>
  )
}

const layout = () => screen.getByTestId('bar').textContent

describe('useCompactActionBar', () => {
  beforeEach(() => {
    deliver = null
    disconnected = 0
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports wide until a width has been measured', () => {
    render(<Probe />)

    // The full row is the honest default: the server renders it, and a client
    // that cannot measure has no reason to hide two of its actions.
    expect(layout()).toBe('wide')
  })

  it.each([
    {
      description: 'a hair under the threshold',
      width: COMPACT_ACTION_BAR_WIDTH - 1,
      expected: 'compact'
    },
    {
      description: 'exactly the threshold',
      width: COMPACT_ACTION_BAR_WIDTH,
      expected: 'wide'
    },
    {
      description: 'well over the threshold',
      width: COMPACT_ACTION_BAR_WIDTH + 400,
      expected: 'wide'
    }
  ])('reports $expected at $description', ({ width, expected }) => {
    render(<Probe />)
    act(() => deliver?.(width))

    expect(layout()).toBe(expected)
  })

  it('ignores a zero width instead of treating it as narrow', () => {
    render(<Probe />)
    act(() => deliver?.(320))
    expect(layout()).toBe('compact')

    // A row inside a `display: none` ancestor (or a detached subtree, or
    // jsdom) measures 0. Reading that as "narrow" would collapse rows that are
    // simply not laid out yet — including every row in a test that stubs
    // ResizeObserver for some unrelated component.
    act(() => deliver?.(0))

    expect(layout()).toBe('compact')
  })

  it('follows the row back to wide when it grows', () => {
    render(<Probe />)
    act(() => deliver?.(320))
    expect(layout()).toBe('compact')

    act(() => deliver?.(900))

    expect(layout()).toBe('wide')
  })

  it('honours a caller-supplied threshold', () => {
    render(<Probe threshold={200} />)
    act(() => deliver?.(320))

    expect(layout()).toBe('wide')
  })

  it('disconnects the observer on unmount', () => {
    const { unmount } = render(<Probe />)
    unmount()

    expect(disconnected).toBe(1)
  })
})
