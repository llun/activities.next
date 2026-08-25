/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'
import { FC, useCallback } from 'react'

import {
  SCROLL_EDGE_TOLERANCE,
  useMediaStripScroll
} from './useMediaStripScroll'

// The hook computes everything from the container's own scroll geometry,
// which jsdom never lays out (scrollWidth/clientWidth are always 0 and
// scrollLeft never moves on its own), so every case has to stamp those three
// properties onto the real node before the hook's eager on-mount `measure()`
// runs. Doing it from inside the ref callback (composed with the hook's own
// `ref`) lands the values during the commit phase, before that effect fires.
const configureScroller = (
  target: HTMLDivElement,
  {
    scrollWidth,
    clientWidth,
    scrollLeft
  }: { scrollWidth: number; clientWidth: number; scrollLeft: number }
) => {
  Object.defineProperty(target, 'scrollWidth', {
    configurable: true,
    value: scrollWidth
  })
  Object.defineProperty(target, 'clientWidth', {
    configurable: true,
    value: clientWidth
  })
  Object.defineProperty(target, 'scrollLeft', {
    configurable: true,
    value: scrollLeft
  })
}

// The hook reads the element directly rather than the observer entry, so the
// stub delivers nothing — but it captures the constructor callback and the
// observed node so a test can prove the hook actually wired the two together
// and re-measures when the callback fires.
let disconnected = 0
let deliver: (() => void) | null = null
let observed: Element | null = null

class ResizeObserverStub {
  constructor(callback: () => void) {
    deliver = callback
  }

  observe(target: Element) {
    observed = target
  }

  unobserve() {}

  disconnect() {
    disconnected += 1
  }
}

// The hook's own `scrollByPage` is captured out of the Probe so tests can
// drive it directly, the same way the house pattern drives a ResizeObserver
// delivery from outside the tree.
let capturedScrollByPage: ((direction: 1 | -1) => void) | null = null

interface ProbeProps {
  scrollWidth: number
  clientWidth: number
  scrollLeft: number
  contentKey?: string
}

const Probe: FC<ProbeProps> = ({
  scrollWidth,
  clientWidth,
  scrollLeft,
  contentKey = '320,160'
}) => {
  const { ref, canScrollLeft, canScrollRight, scrollByPage } =
    useMediaStripScroll(contentKey)
  capturedScrollByPage = scrollByPage

  // Stable across re-renders triggered by the hook's own `setEdges` (the
  // deps below never change within a single test), so React never detaches
  // and reattaches this ref on the already-mounted node.
  const scrollerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node)
        configureScroller(node, { scrollWidth, clientWidth, scrollLeft })
      ref(node)
    },
    [ref, scrollWidth, clientWidth, scrollLeft]
  )

  return (
    <div>
      <div ref={scrollerRef} data-testid="scroller" />
      <span data-testid="left">{String(canScrollLeft)}</span>
      <span data-testid="right">{String(canScrollRight)}</span>
    </div>
  )
}

describe('useMediaStripScroll', () => {
  beforeEach(() => {
    disconnected = 0
    deliver = null
    observed = null
    capturedScrollByPage = null
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    {
      description:
        'has no scrollable edges when content fits within the container',
      scrollWidth: 500,
      clientWidth: 500,
      scrollLeft: 0,
      expectedLeft: false,
      expectedRight: false
    },
    {
      description:
        'can scroll right but not left at the start of overflowing content',
      scrollWidth: 1000,
      clientWidth: 500,
      scrollLeft: 0,
      expectedLeft: false,
      expectedRight: true
    },
    {
      description:
        'can scroll left but not right at the end of overflowing content',
      scrollWidth: 1000,
      clientWidth: 500,
      scrollLeft: 500,
      expectedLeft: true,
      expectedRight: false
    },
    {
      description:
        'can scroll both ways from the middle of overflowing content',
      scrollWidth: 1000,
      clientWidth: 500,
      scrollLeft: 250,
      expectedLeft: true,
      expectedRight: true
    }
  ])(
    '$description',
    ({ scrollWidth, clientWidth, scrollLeft, expectedLeft, expectedRight }) => {
      render(
        <Probe
          scrollWidth={scrollWidth}
          clientWidth={clientWidth}
          scrollLeft={scrollLeft}
        />
      )

      expect(screen.getByTestId('left')).toHaveTextContent(String(expectedLeft))
      expect(screen.getByTestId('right')).toHaveTextContent(
        String(expectedRight)
      )
    }
  )

  // clientWidth 500, scrollWidth 1000 => maxScrollLeft 500, so the right edge's
  // own dead zone sits at 500 - SCROLL_EDGE_TOLERANCE.
  const MAX_SCROLL_LEFT = 500

  it.each([
    {
      description: 'does not enable left scroll exactly at the tolerance',
      scrollLeft: SCROLL_EDGE_TOLERANCE,
      testId: 'left',
      expected: false
    },
    {
      description: 'enables left scroll just past the tolerance',
      scrollLeft: SCROLL_EDGE_TOLERANCE + 1,
      testId: 'left',
      expected: true
    },
    {
      description:
        'does not enable right scroll within the tolerance of the maximum',
      scrollLeft: MAX_SCROLL_LEFT - SCROLL_EDGE_TOLERANCE,
      testId: 'right',
      expected: false
    },
    {
      description: 'enables right scroll just past the tolerance',
      scrollLeft: MAX_SCROLL_LEFT - SCROLL_EDGE_TOLERANCE - 1,
      testId: 'right',
      expected: true
    }
  ])('$description', ({ scrollLeft, testId, expected }) => {
    render(
      <Probe scrollWidth={1000} clientWidth={500} scrollLeft={scrollLeft} />
    )

    expect(screen.getByTestId(testId)).toHaveTextContent(String(expected))
  })

  it.each([
    {
      description:
        'scrolls right by 0.7 of the visible width on scrollByPage(1)',
      direction: 1 as const,
      expectedLeft: 233
    },
    {
      description:
        'scrolls left by 0.7 of the visible width on scrollByPage(-1)',
      direction: -1 as const,
      expectedLeft: -233
    }
  ])('$description', ({ direction, expectedLeft }) => {
    render(<Probe scrollWidth={1000} clientWidth={333} scrollLeft={0} />)
    const scroller = screen.getByTestId('scroller')
    const scrollBy = vi.fn()
    // jsdom has no scrollBy implementation to spy on.
    Object.defineProperty(scroller, 'scrollBy', {
      configurable: true,
      value: scrollBy
    })

    act(() => capturedScrollByPage?.(direction))

    expect(scrollBy).toHaveBeenCalledWith({
      left: expectedLeft,
      behavior: 'smooth'
    })
  })

  it('re-measures when the content key changes without the container resizing', () => {
    // The observer watches the container, so a strip whose items were swapped
    // for narrower ones — same count, same box, same scrollLeft — only notices
    // through the content key.
    const { rerender } = render(
      <Probe
        scrollWidth={1000}
        clientWidth={500}
        scrollLeft={0}
        contentKey="320,576"
      />
    )
    expect(screen.getByTestId('right')).toHaveTextContent('true')

    rerender(
      <Probe
        scrollWidth={400}
        clientWidth={500}
        scrollLeft={0}
        contentKey="320,160"
      />
    )

    expect(screen.getByTestId('right')).toHaveTextContent('false')
  })

  it('observes the scroll container itself, not the viewport', () => {
    render(<Probe scrollWidth={1000} clientWidth={500} scrollLeft={0} />)

    expect(observed).toBe(screen.getByTestId('scroller'))
  })

  it('re-measures when the observer fires', () => {
    // The container resizing is the whole reason the hook holds an observer: a
    // post can be re-laid-out (a sidebar collapses, a column widens) without
    // any scroll event or content change. Without this the affordances would
    // stay painted over a strip that no longer overflows.
    const scroller = { scrollWidth: 1000, clientWidth: 500, scrollLeft: 0 }
    render(
      <Probe
        scrollWidth={scroller.scrollWidth}
        clientWidth={scroller.clientWidth}
        scrollLeft={scroller.scrollLeft}
      />
    )
    expect(screen.getByTestId('right')).toHaveTextContent('true')

    // The column grew, so the same content now fits.
    Object.defineProperty(screen.getByTestId('scroller'), 'clientWidth', {
      configurable: true,
      value: 1000
    })
    act(() => deliver?.())

    expect(screen.getByTestId('right')).toHaveTextContent('false')
  })

  it('disconnects the resize observer on unmount', () => {
    const { unmount } = render(
      <Probe scrollWidth={1000} clientWidth={500} scrollLeft={0} />
    )

    unmount()

    expect(disconnected).toBe(1)
  })

  it('still measures eagerly and does not throw when ResizeObserver is unavailable', () => {
    const original = (globalThis as { ResizeObserver?: unknown }).ResizeObserver
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver

    try {
      expect(() =>
        render(<Probe scrollWidth={1000} clientWidth={500} scrollLeft={0} />)
      ).not.toThrow()

      expect(screen.getByTestId('left')).toHaveTextContent('false')
      expect(screen.getByTestId('right')).toHaveTextContent('true')
    } finally {
      ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = original
    }
  })
})
