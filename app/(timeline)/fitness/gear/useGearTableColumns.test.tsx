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

const Probe: FC<{ hasTable?: boolean }> = ({ hasTable = true }) => {
  const { ref, isSnapping, pinnedColumnStyle, dataColumnStyle, scrollerStyle } =
    useGearTableColumns(PINNED_WIDTH)
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

  it('floors a snapped column so a long distance still fits on one line', () => {
    render(<Probe />)
    act(() => deliver?.(240))

    expect(styleOf('data').width).toBe('160px')
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
