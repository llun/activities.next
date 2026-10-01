/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { FC } from 'react'

import { useGearTableColumns } from './useGearTableColumns'

// A ResizeObserver whose deliveries the test drives, so the width the hook sees
// is the width under test rather than jsdom's (which lays nothing out and
// reports 0 for everything).
let deliver: ((width: number) => void) | null = null
// The hook also observes the scroller's content, so the scroll cues follow a
// table that changes width inside a scroller that does not.
let resizeContent: (() => void) | null = null
let disconnected = 0

class ResizeObserverStub {
  private observing = false

  constructor(
    private readonly callback: (entries: ResizeObserverEntry[]) => void
  ) {}

  observe(target: Element) {
    if (this.observing) {
      resizeContent = () =>
        this.callback([{ target } as unknown as ResizeObserverEntry])
      return
    }
    this.observing = true
    // The hook reads the observed element's own `clientWidth` rather than the
    // entry's `contentRect`, so that is what a delivery has to set. jsdom lays
    // nothing out and reports 0 for it, hence the override.
    deliver = (width: number) => {
      Object.defineProperty(target, 'clientWidth', {
        configurable: true,
        value: width
      })
      Object.defineProperty(target, 'scrollWidth', {
        configurable: true,
        value: 1200
      })
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

const PINNED_WIDTH = 104

// The components table pins at 120px (`TYPE_COLUMN_WIDTH`). The overhang cap
// applies at either pin — only the width it starts at moves, from below 276px
// at the default to below 292px here — but the 320px-viewport regression it
// exists for reproduces only at the wider one, so the case covering that passes
// the pin explicitly rather than inheriting the default.
const COMPONENTS_PINNED_WIDTH = 120

const Probe: FC<{
  hasTable?: boolean
  pinnedWidth?: number
  pinnedRightWidth?: number
  totalColumns?: number
  targetColumnWidth?: number
}> = ({
  hasTable = true,
  pinnedWidth = PINNED_WIDTH,
  pinnedRightWidth,
  totalColumns,
  targetColumnWidth
}) => {
  const {
    ref,
    isSnapping,
    canScrollLeft,
    canScrollRight,
    scrollByColumn,
    isRightPinned,
    pinnedColumnStyle,
    pinnedRightStyle,
    dataColumnStyle,
    scrollerStyle
  } = useGearTableColumns(pinnedWidth, {
    pinnedRightWidth,
    totalColumns,
    targetColumnWidth
  })
  if (!hasTable) return <p>No components yet.</p>
  return (
    <div ref={ref} data-testid="scroller" style={scrollerStyle}>
      <span data-testid="mode">{isSnapping ? 'snapping' : 'wide'}</span>
      <span data-testid="can-left">{String(canScrollLeft)}</span>
      <span data-testid="can-right">{String(canScrollRight)}</span>
      <span data-testid="right-pinned">{String(isRightPinned)}</span>
      <button data-testid="step-left" onClick={() => scrollByColumn('left')} />
      <button
        data-testid="step-right"
        onClick={() => scrollByColumn('right')}
      />
      <span data-testid="pinned" style={pinnedColumnStyle} />
      <span data-testid="pinned-right" style={pinnedRightStyle} />
      <span data-testid="data" style={dataColumnStyle(96)} />
    </div>
  )
}

const styleOf = (testId: string) => screen.getByTestId(testId).style

describe('useGearTableColumns', () => {
  beforeEach(() => {
    deliver = null
    resizeContent = null
    disconnected = 0
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports a wide table before anything has been measured', () => {
    render(<Probe />)

    expect(screen.getByTestId('mode')).toHaveTextContent('wide')
    expect(styleOf('scroller').scrollSnapType).toBe('')
    expect(styleOf('data').minWidth).toBe('96px')
    expect(styleOf('data').width).toBe('')
  })

  it.each([
    {
      description: 'stays wide at the threshold where all columns fit',
      width: PINNED_WIDTH + 7 * 180
    },
    {
      description: 'stays wide above the threshold where all columns fit',
      width: PINNED_WIDTH + 7 * 180 + 200
    }
  ])('$description', ({ width }) => {
    render(<Probe />)
    act(() => deliver?.(width))

    expect(screen.getByTestId('mode')).toHaveTextContent('wide')
    expect(styleOf('data').width).toBe('')
  })

  it('snaps one data column per swipe on narrow viewports', () => {
    render(<Probe />)
    act(() => deliver?.(390))

    expect(screen.getByTestId('mode')).toHaveTextContent('snapping')
    // Each data column takes exactly what the pinned column leaves over, so a
    // snap brings one — and only one — into view.
    expect(styleOf('data').width).toBe(`${390 - PINNED_WIDTH}px`)
    expect(styleOf('data').maxWidth).toBe(`${390 - PINNED_WIDTH}px`)
    expect(styleOf('data').textAlign).toBe('right')
    expect(styleOf('scroller').scrollSnapType).toBe('x mandatory')
    expect(styleOf('scroller').scrollPaddingLeft).toBe(`${PINNED_WIDTH}px`)
    expect(styleOf('pinned').width).toBe(`${PINNED_WIDTH}px`)
  })

  it('snaps multiple whole columns on wider viewports without half columns', () => {
    render(<Probe />)
    // 104 pinned + 450 available = 554 total; fits floor(450 / 180) = 2 columns of 225px.
    act(() => deliver?.(554))

    expect(screen.getByTestId('mode')).toHaveTextContent('snapping')
    expect(styleOf('data').width).toBe('225px')
    expect(styleOf('data').maxWidth).toBe('225px')
    expect(styleOf('data').textAlign).toBe('')
    expect(styleOf('scroller').scrollSnapType).toBe('x mandatory')
    expect(styleOf('scroller').scrollPaddingLeft).toBe(`${PINNED_WIDTH}px`)
  })

  it('floors a snapped column so the distance and its wear line still fit', () => {
    render(<Probe />)
    act(() => deliver?.(300))

    // 300 - 104 = 196, wider than the floor, so nothing is floored.
    expect(styleOf('data').width).toBe('196px')

    // 280 - 104 = 176 is under it, so the floor takes over and the column
    // overflows the scroller by 8px — inside the cell's own 12px of right
    // padding, so the wear line gains room and the value stays visible.
    act(() => deliver?.(280))
    expect(styleOf('data').width).toBe('184px')
  })

  // The floored column hangs off the scroller, and `x mandatory` means the
  // reader cannot scroll to what hangs off — so past the cell's own 12px of
  // right padding the overhang starts eating the right-aligned distance itself.
  it('stops the floor pushing the distance off the scrollport', () => {
    render(<Probe />)
    act(() => deliver?.(286))

    // 286 - 104 = 182 available; the floor would take 184, overflowing by 2 —
    // inside the padding, so the floor still applies here.
    expect(styleOf('data').width).toBe('184px')

    // 240 - 104 = 136 available. The floor's 184 would hang 48px off the edge
    // and hide the distance, so the column stops at one padding's worth of
    // overhang — which leaves the value flush with the scroller's edge rather
    // than 12px short of it, the same place it lands at every other width.
    act(() => deliver?.(240))
    expect(styleOf('data').width).toBe('148px')
  })

  // The regression this cap exists for, at the pin that produced it: the
  // components table pins at 120px, and a 320px viewport leaves a 286px
  // scroller. The floor's 184 there hung 18px off the edge and took 6px of the
  // distance with it. At the default 104px pin the same width is fine, which is
  // why the case above does not reproduce it.
  it('caps the overhang at the components table pin', () => {
    render(<Probe pinnedWidth={COMPONENTS_PINNED_WIDTH} />)
    act(() => deliver?.(286))

    expect(styleOf('data').width).toBe('178px')
    expect(styleOf('scroller').scrollPaddingLeft).toBe(
      `${COMPONENTS_PINNED_WIDTH}px`
    )
  })

  it('keeps the last measured width when the table reports zero', () => {
    render(<Probe />)
    act(() => deliver?.(390))
    expect(screen.getByTestId('mode')).toHaveTextContent('snapping')

    // A hidden or detached ancestor reports 0 for everything. Believing it
    // would drop a snapped table back to the unpinned layout and leave it
    // there until something resized it again.
    act(() => deliver?.(0))

    expect(screen.getByTestId('mode')).toHaveTextContent('snapping')
    expect(styleOf('data').width).toBe(`${390 - PINNED_WIDTH}px`)
  })

  it('measures a table that mounts after the empty state', () => {
    // The components card renders no table at all until something is
    // installed, so the observer has to attach when that table appears rather
    // than only at the card's own mount.
    const { rerender } = render(<Probe hasTable={false} />)
    expect(deliver).toBeNull()

    rerender(<Probe hasTable />)
    act(() => deliver?.(390))

    expect(screen.getByTestId('mode')).toHaveTextContent('snapping')
    expect(styleOf('data').width).toBe(`${390 - PINNED_WIDTH}px`)
  })

  it('drops its observer when the table unmounts', () => {
    const { rerender } = render(<Probe hasTable />)
    rerender(<Probe hasTable={false} />)

    expect(disconnected).toBe(1)
  })

  it('fits 4 middle columns on widest desktop when dual-pinned', () => {
    render(
      <Probe
        pinnedWidth={120}
        pinnedRightWidth={140}
        totalColumns={6}
        targetColumnWidth={150}
      />
    )
    // 908 container width - 120 left - 140 right = 648 available.
    // floor(648 / 150) = 4 columns of floor(648 / 4) = 162px.
    act(() => deliver?.(908))

    expect(screen.getByTestId('mode')).toHaveTextContent('snapping')
    expect(styleOf('data').width).toBe('162px')
    expect(styleOf('data').transition).toContain('width 250ms')
    expect(styleOf('pinned').width).toBe('120px')
    expect(styleOf('pinned-right').width).toBe('140px')
    expect(styleOf('scroller').scrollSnapType).toBe('x mandatory')
    expect(styleOf('scroller').scrollPaddingLeft).toBe('120px')
    expect(styleOf('scroller').scrollPaddingRight).toBe('140px')
  })

  it('steps by column with scrollByColumn', () => {
    render(
      <Probe
        pinnedWidth={120}
        pinnedRightWidth={140}
        totalColumns={6}
        targetColumnWidth={150}
      />
    )
    act(() => deliver?.(908))

    const scroller = screen.getByTestId('scroller')
    const scrollBySpy = vi.fn()
    scroller.scrollBy = scrollBySpy

    screen.getByTestId('step-right').click()
    expect(scrollBySpy).toHaveBeenCalledWith({
      left: 162,
      behavior: 'smooth'
    })

    screen.getByTestId('step-left').click()
    expect(scrollBySpy).toHaveBeenCalledWith({
      left: -162,
      behavior: 'smooth'
    })
  })

  it('tracks canScrollLeft and canScrollRight across scroll range', () => {
    render(
      <Probe
        pinnedWidth={120}
        pinnedRightWidth={140}
        totalColumns={6}
        targetColumnWidth={150}
      />
    )
    act(() => deliver?.(908))

    const scroller = screen.getByTestId('scroller')
    // Initially at scrollLeft = 0: cannot scroll left, can scroll right
    expect(screen.getByTestId('can-left')).toHaveTextContent('false')
    expect(screen.getByTestId('can-right')).toHaveTextContent('true')

    // Scrolled into the middle
    act(() => {
      Object.defineProperty(scroller, 'scrollLeft', {
        configurable: true,
        writable: true,
        value: 100
      })
      fireEvent.scroll(scroller)
    })
    expect(screen.getByTestId('can-left')).toHaveTextContent('true')
    expect(screen.getByTestId('can-right')).toHaveTextContent('true')

    // Scrolled to the end (scrollWidth 1200 - clientWidth 908 = 292 maxScroll)
    act(() => {
      Object.defineProperty(scroller, 'scrollLeft', {
        configurable: true,
        writable: true,
        value: 292
      })
      fireEvent.scroll(scroller)
    })
    expect(screen.getByTestId('can-left')).toHaveTextContent('true')
    expect(screen.getByTestId('can-right')).toHaveTextContent('false')
  })

  // A phone fits the left pin and one snapped column; pinning the right
  // column as well would leave the data a sliver, so it snaps instead.
  it.each([
    {
      description: 'snaps the right column as the last data column below 480px',
      width: 479,
      expected: {
        pinned: false,
        data: '359px',
        paddingRight: '',
        textAlign: 'right'
      }
    },
    {
      description: 'pins the right column from 480px',
      width: 480,
      expected: {
        pinned: true,
        data: '220px',
        paddingRight: '140px',
        textAlign: 'right'
      }
    },
    {
      description: 'pins the right column on a tablet',
      width: 600,
      expected: {
        pinned: true,
        data: '170px',
        paddingRight: '140px',
        textAlign: ''
      }
    }
  ])('$description', ({ width, expected }) => {
    render(
      <Probe
        pinnedWidth={120}
        pinnedRightWidth={140}
        totalColumns={6}
        targetColumnWidth={150}
      />
    )
    act(() => deliver?.(width))

    expect(screen.getByTestId('mode')).toHaveTextContent('snapping')
    expect(screen.getByTestId('right-pinned')).toHaveTextContent(
      String(expected.pinned)
    )
    expect(styleOf('data').width).toBe(expected.data)
    expect(styleOf('data').textAlign).toBe(expected.textAlign)
    expect(styleOf('scroller').scrollPaddingLeft).toBe('120px')
    expect(styleOf('scroller').scrollPaddingRight).toBe(expected.paddingRight)
  })

  it('keeps the right column pinned before anything has been measured', () => {
    render(<Probe pinnedWidth={120} pinnedRightWidth={140} />)

    expect(screen.getByTestId('right-pinned')).toHaveTextContent('true')
    expect(styleOf('pinned-right').minWidth).toBe('140px')
  })

  it('reports no right pin when none was asked for', () => {
    render(<Probe />)
    act(() => deliver?.(908))

    expect(screen.getByTestId('right-pinned')).toHaveTextContent('false')
  })

  describe('under reduced motion', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({
          matches: query === '(prefers-reduced-motion: reduce)'
        }))
      )
    })

    it('neither animates the columns nor smooth-scrolls a step', () => {
      render(
        <Probe
          pinnedWidth={120}
          pinnedRightWidth={140}
          totalColumns={6}
          targetColumnWidth={150}
        />
      )
      act(() => deliver?.(908))

      expect(styleOf('data').transition).toBe('')

      const scroller = screen.getByTestId('scroller')
      const scrollBySpy = vi.fn()
      scroller.scrollBy = scrollBySpy
      screen.getByTestId('step-right').click()
      expect(scrollBySpy).toHaveBeenCalledWith({ left: 162, behavior: 'auto' })
    })
  })

  // Re-snapping, a width animation or a wider value all change what overflows
  // without resizing the scroller itself.
  it('re-reads the scroll cues when the content resizes', () => {
    render(
      <Probe
        pinnedWidth={120}
        pinnedRightWidth={140}
        totalColumns={6}
        targetColumnWidth={150}
      />
    )
    act(() => deliver?.(908))
    expect(screen.getByTestId('can-right')).toHaveTextContent('true')

    const scroller = screen.getByTestId('scroller')
    act(() => {
      Object.defineProperty(scroller, 'scrollWidth', {
        configurable: true,
        value: 908
      })
      resizeContent?.()
    })

    expect(screen.getByTestId('can-right')).toHaveTextContent('false')
  })

  it('disconnects its observer on unmount', () => {
    const { unmount } = render(<Probe />)
    unmount()

    expect(disconnected).toBe(1)
  })
})
