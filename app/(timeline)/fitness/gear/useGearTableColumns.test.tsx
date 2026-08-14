/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'
import { FC } from 'react'

import {
  GEAR_TABLE_SNAP_WIDTH,
  useGearTableColumns
} from './useGearTableColumns'

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
    // The hook reads the observed element's own `clientWidth` rather than the
    // entry's `contentRect`, so that is what a delivery has to set. jsdom lays
    // nothing out and reports 0 for it, hence the override.
    deliver = (width: number) => {
      Object.defineProperty(target, 'clientWidth', {
        configurable: true,
        value: width
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

const Probe: FC<{ hasTable?: boolean; pinnedWidth?: number }> = ({
  hasTable = true,
  pinnedWidth = PINNED_WIDTH
}) => {
  const { ref, isSnapping, pinnedColumnStyle, dataColumnStyle, scrollerStyle } =
    useGearTableColumns(pinnedWidth)
  if (!hasTable) return <p>No components yet.</p>
  return (
    <div ref={ref} data-testid="scroller" style={scrollerStyle}>
      <span data-testid="mode">{isSnapping ? 'snapping' : 'wide'}</span>
      <span data-testid="pinned" style={pinnedColumnStyle} />
      <span data-testid="data" style={dataColumnStyle(96)} />
    </div>
  )
}

const styleOf = (testId: string) => screen.getByTestId(testId).style

describe('useGearTableColumns', () => {
  beforeEach(() => {
    deliver = null
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
      description: 'stays wide at the threshold',
      width: GEAR_TABLE_SNAP_WIDTH
    },
    {
      description: 'stays wide above the threshold',
      width: GEAR_TABLE_SNAP_WIDTH + 200
    }
  ])('$description', ({ width }) => {
    render(<Probe />)
    act(() => deliver?.(width))

    expect(screen.getByTestId('mode')).toHaveTextContent('wide')
    expect(styleOf('data').width).toBe('')
  })

  it('snaps one data column per swipe below the threshold', () => {
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

  it('disconnects its observer on unmount', () => {
    const { unmount } = render(<Probe />)
    unmount()

    expect(disconnected).toBe(1)
  })
})
