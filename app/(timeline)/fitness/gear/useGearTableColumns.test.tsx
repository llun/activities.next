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

const PINNED_WIDTH = 104

const Probe: FC = () => {
  const { ref, isSnapping, pinnedColumnStyle, dataColumnStyle, scrollerStyle } =
    useGearTableColumns(PINNED_WIDTH)
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

  it('ignores a zero width rather than snapping an unlaid-out table', () => {
    render(<Probe />)
    act(() => deliver?.(700))
    act(() => deliver?.(0))

    expect(screen.getByTestId('mode')).toHaveTextContent('wide')
  })

  it('disconnects its observer on unmount', () => {
    const { unmount } = render(<Probe />)
    unmount()

    expect(disconnected).toBe(1)
  })
})
