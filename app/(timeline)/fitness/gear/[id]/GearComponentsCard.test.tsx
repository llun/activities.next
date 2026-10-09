/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  STICKY_HEAD_CELL,
  STICKY_LEFT_SHADOW,
  STICKY_RIGHT_SHADOW
} from '@/app/(timeline)/fitness/gear/gearUi'
import {
  createFitnessGearComponent,
  deleteFitnessGearComponent,
  refitFitnessGearComponent,
  retireFitnessGearComponent,
  updateFitnessGearComponent
} from '@/lib/client'
import type { GearComponentEntity } from '@/lib/services/fitness-gears/gearEntities'

import { GearComponentsCard } from './GearComponentsCard'

vi.mock('@/lib/client', () => ({
  createFitnessGearComponent: vi.fn(),
  deleteFitnessGearComponent: vi.fn(),
  refitFitnessGearComponent: vi.fn(),
  retireFitnessGearComponent: vi.fn(),
  updateFitnessGearComponent: vi.fn()
}))

const mockCreateFitnessGearComponent =
  createFitnessGearComponent as jest.MockedFunction<
    typeof createFitnessGearComponent
  >
const mockUpdateFitnessGearComponent =
  updateFitnessGearComponent as jest.MockedFunction<
    typeof updateFitnessGearComponent
  >
const mockDeleteFitnessGearComponent =
  deleteFitnessGearComponent as jest.MockedFunction<
    typeof deleteFitnessGearComponent
  >
const mockRetireFitnessGearComponent =
  retireFitnessGearComponent as jest.MockedFunction<
    typeof retireFitnessGearComponent
  >
const mockRefitFitnessGearComponent =
  refitFitnessGearComponent as jest.MockedFunction<
    typeof refitFitnessGearComponent
  >

// `periods` defaults to the single period the derived `addedAt`/`removedAt`
// describe, so a fixture that only sets those two stays self-consistent. A test
// about install history passes `periods` explicitly.
const createComponent = (
  overrides: Partial<GearComponentEntity> = {}
): GearComponentEntity => {
  const component = {
    id: 'component-1',
    gearId: 'gear-1',
    componentType: 'Chain',
    brand: 'Shimano',
    model: 'HG701',
    addedAt: Date.UTC(2024, 0, 15),
    removedAt: null,
    serviceDistanceMeters: null,
    distanceMeters: 2450000,
    activityCount: 82,
    productUrl: 'https://bike.shimano.com/chain',
    ...overrides
  }
  return {
    ...component,
    periods: overrides.periods ?? [
      { addedAt: component.addedAt, removedAt: component.removedAt }
    ]
  }
}

// jsdom has no ResizeObserver, so without this stub `useGearTableColumns`
// early-returns and none of the pinning or snapping below is exercised at all.
let deliverWidth: ((width: number) => void) | null = null

class ResizeObserverStub {
  private observing = false

  constructor(
    private readonly callback: (entries: ResizeObserverEntry[]) => void
  ) {}

  // The hook observes the scroller first and then the table inside it (for
  // the scroll cues); deliveries drive the scroller, so only the first target
  // is wired up.
  observe(target: Element) {
    if (this.observing) return
    this.observing = true
    deliverWidth = (width: number) => {
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
  disconnect() {}
}

const renderCard = (components: GearComponentEntity[], onChanged = vi.fn()) => {
  render(
    <GearComponentsCard
      gearId="gear-1"
      components={components}
      onChanged={onChanged}
    />
  )
  return onChanged
}

describe('GearComponentsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateFitnessGearComponent.mockResolvedValue(createComponent())
    mockDeleteFitnessGearComponent.mockResolvedValue(undefined)
    mockRetireFitnessGearComponent.mockResolvedValue(
      createComponent({ removedAt: Date.UTC(2025, 5, 1) })
    )
    // Without this default the refit tests pass only on a neighbour's
    // leaked implementation: `vi.clearAllMocks()` resets call history and
    // leaves implementations in place, so whichever test last set one on this
    // mock decides what the next test sees — including the rejection from
    // "surfaces a refit failure". Remove it and `--sequence.shuffle` fails.
    mockRefitFitnessGearComponent.mockResolvedValue(
      createComponent({ removedAt: null })
    )
    mockUpdateFitnessGearComponent.mockResolvedValue(createComponent())
  })

  it('renders the header with the installed count', () => {
    renderCard([createComponent(), createComponent({ id: 'c2' })])

    expect(
      screen.getByRole('heading', { name: 'Components' })
    ).toBeInTheDocument()
    expect(screen.getByText('2 installed')).toBeInTheDocument()
  })

  describe('responsive columns', () => {
    beforeEach(() => {
      deliverWidth = null
      vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    const columnCells = (index: number) => [
      screen.getAllByRole('columnheader')[index],
      ...screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.children[index])
    ]

    // jsdom lays nothing out, so this cannot measure the text — it guards the
    // budget the width was derived from instead. The pinned cell is `px-4`, so
    // 32px of the column is padding; "Chainrings", the widest single word in
    // `COMPONENT_TYPE_OPTIONS`, measures 74.7px at `text-sm font-medium` and
    // "Handlebar" 72.6px. At the design's 104px the content box was 72px and
    // "Handlebar" broke mid-word as "Handleba / r", which is what `wrap-anywhere`
    // does to a word that does not fit.
    it('leaves the type column room for the longest single-word component type', () => {
      renderCard([createComponent({ componentType: 'Handlebar' })])
      act(() => deliverWidth?.(390))

      const [typeHeader] = columnCells(0)
      const width = Number.parseInt((typeHeader as HTMLElement).style.width, 10)
      expect(width - 32).toBeGreaterThanOrEqual(75)
    })

    // A header and body that disagree is how a pinned column ends up
    // straddling the boundary it is meant to hold.
    it.each([
      {
        description: 'a phone, actions snapped',
        width: 390,
        expected: { type: '120px', middle: '270px', actions: '270px' }
      },
      {
        description: 'a tablet, actions pinned',
        width: 600,
        expected: { type: '120px', middle: '170px', actions: '140px' }
      }
    ])(
      'gives a column the same width in its header and its body on $description',
      ({ width, expected }) => {
        renderCard([createComponent(), createComponent({ id: 'c2' })])
        act(() => deliverWidth?.(width))

        for (const index of [0, 1, 2, 7]) {
          const widths = columnCells(index).map(
            (cell) => (cell as HTMLElement).style.width
          )
          expect(new Set(widths).size).toBe(1)
          expect(widths[0]).toBe(
            index === 0
              ? expected.type
              : index === 7
                ? expected.actions
                : expected.middle
          )
        }
      }
    )

    // A phone has room for the pinned type column and one more; pinning the
    // actions as well squeezed the data into a sliver between them, so there
    // the actions snap as the last data column, as they did before.
    it('snaps the actions as the last data column on a phone', () => {
      renderCard([createComponent()])
      act(() => deliverWidth?.(390))

      for (const cell of columnCells(7)) {
        expect((cell as HTMLElement).style.scrollSnapAlign).toBe('start')
      }
      const scroller = screen.getByRole('table').parentElement as HTMLElement
      expect(scroller).toHaveStyle({
        scrollSnapType: 'x mandatory',
        scrollPaddingLeft: '120px'
      })
      expect(scroller.style.scrollPaddingRight).toBe('')
    })

    // jsdom lays nothing out, so this guards the containing block instead of
    // the page width. The Added/Retired cells are never positioned, so a
    // refitted component's `sr-only` "Install N:" labels (`position: absolute`)
    // leaked out of the scroller's overflow clip at every width the table
    // scrolls — here the actions are pinned and the labels still have nothing
    // positioned between them and the scroller.
    it('keeps the install labels inside a positioned scroller with the actions pinned', () => {
      renderCard([
        createComponent({
          periods: [
            { addedAt: Date.UTC(2024, 0, 15), removedAt: Date.UTC(2024, 5, 1) },
            { addedAt: Date.UTC(2024, 10, 20), removedAt: null }
          ]
        })
      ])
      act(() => deliverWidth?.(600))

      const scroller = screen.getByRole('table').parentElement as HTMLElement
      expect(scroller).toHaveClass('relative', 'overflow-x-auto')
      const labels = screen.getAllByText(/^Install \d+:$/)
      expect(labels).toHaveLength(4)
      for (const label of labels) {
        expect(label).toHaveClass('sr-only')
        expect(label.closest('.sticky')).toBeNull()
        expect(scroller).toContainElement(label)
      }
    })

    it('pins the type and actions columns and snaps the middle above a phone', () => {
      renderCard([createComponent()])
      act(() => deliverWidth?.(600))

      for (const cell of columnCells(7)) {
        expect((cell as HTMLElement).style.scrollSnapAlign).toBe('')
      }
      const [, brandHeader] = screen.getAllByRole('columnheader')
      expect((brandHeader as HTMLElement).style.scrollSnapAlign).toBe('start')
      expect(screen.getByRole('table').parentElement).toHaveStyle({
        scrollSnapType: 'x mandatory',
        scrollPaddingLeft: '120px',
        scrollPaddingRight: '140px'
      })
    })

    it('leaves a wide table unsnapped, with the type column still pinned and the brand and actions columns at least 140px wide', () => {
      renderCard([createComponent({ brand: 'Continental' })])
      act(() => deliverWidth?.(1400))

      const [typeHeader] = columnCells(0)
      expect(typeHeader).toHaveClass('sticky')
      expect((typeHeader as HTMLElement).style.width).toBe('')
      const [, brandHeader] = screen.getAllByRole('columnheader')
      expect((brandHeader as HTMLElement).style.scrollSnapAlign).toBe('')
      expect(screen.getByRole('table').parentElement).not.toHaveStyle({
        scrollSnapType: 'x mandatory'
      })
      for (const index of [1, 7]) {
        const [header, cell] = columnCells(index)
        expect((header as HTMLElement).style.minWidth).toBe('140px')
        expect((cell as HTMLElement).style.minWidth).toBe('140px')
      }
    })

    it('snaps multiple whole columns on mid-width viewports without half columns', () => {
      renderCard([createComponent()])
      // 120 pinned left + 140 pinned right + 640 available = 900 total; fits floor(640 / 150) = 4 middle columns of 160px.
      act(() => deliverWidth?.(900))

      const [typeHeader] = columnCells(0)
      expect(typeHeader).toHaveClass('sticky')
      expect((typeHeader as HTMLElement).style.width).toBe('120px')
      const [actionsHeader] = columnCells(7)
      expect(actionsHeader).toHaveClass('sticky')
      expect((actionsHeader as HTMLElement).style.width).toBe('140px')
      const [, brandHeader] = screen.getAllByRole('columnheader')
      expect((brandHeader as HTMLElement).style.scrollSnapAlign).toBe('start')
      expect((brandHeader as HTMLElement).style.width).toBe('160px')
      expect(screen.getByRole('table').parentElement).toHaveStyle({
        scrollSnapType: 'x mandatory',
        scrollPaddingLeft: '120px',
        scrollPaddingRight: '140px'
      })
    })

    it.each([
      { description: 'before the table is measured', width: null },
      { description: 'while every column fits', width: 1400 }
    ])('offers no scroll chevrons $description', ({ width }) => {
      renderCard([createComponent()])
      if (width !== null) act(() => deliverWidth?.(width))

      expect(
        screen.queryByRole('button', { name: 'Scroll components table left' })
      ).toBeNull()
      expect(
        screen.queryByRole('button', { name: 'Scroll components table right' })
      ).toBeNull()
    })

    it('drops the scroll chevrons when the table gives way to the empty state', () => {
      const component = createComponent()
      const { rerender } = render(
        <GearComponentsCard
          gearId="gear-1"
          components={[component]}
          onChanged={vi.fn()}
        />
      )
      act(() => deliverWidth?.(390))
      expect(
        screen.getByRole('button', { name: 'Scroll components table right' })
      ).toBeInTheDocument()

      // Retiring the only installed part hides its row, and with retired
      // rows collapsed the card shows its empty state instead of a table.
      rerender(
        <GearComponentsCard
          gearId="gear-1"
          components={[{ ...component, removedAt: Date.UTC(2025, 5, 1) }]}
          onChanged={vi.fn()}
        />
      )

      expect(screen.queryByRole('table')).toBeNull()
      expect(
        screen.queryByRole('button', { name: 'Scroll components table right' })
      ).toBeNull()
    })

    // The step size and the cue thresholds belong to `useGearTableColumns`
    // and are tested there; this covers the card's wiring of them.
    it('steps the table with chevrons that stay focusable at either end', () => {
      renderCard([createComponent()])
      act(() => deliverWidth?.(900))

      const leftButton = screen.getByRole('button', {
        name: 'Scroll components table left'
      })
      const rightButton = screen.getByRole('button', {
        name: 'Scroll components table right'
      })
      const scroller = screen.getByRole('table').parentElement as HTMLElement
      const scrollBySpy = vi.fn()
      scroller.scrollBy = scrollBySpy

      // At the start only the right one acts — and the left one is
      // `aria-disabled` rather than `disabled`, so a keyboard user who
      // stepped back to the start keeps focus on it.
      expect(leftButton).toHaveAttribute('aria-disabled', 'true')
      expect(leftButton).toBeEnabled()
      expect(rightButton).toHaveAttribute('aria-disabled', 'false')
      fireEvent.click(leftButton)
      expect(scrollBySpy).not.toHaveBeenCalled()
      fireEvent.click(rightButton)
      expect(scrollBySpy).toHaveBeenCalledTimes(1)

      act(() => {
        Object.defineProperty(scroller, 'scrollLeft', {
          configurable: true,
          value: 300
        })
        fireEvent.scroll(scroller)
      })

      expect(leftButton).toHaveAttribute('aria-disabled', 'false')
      expect(rightButton).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(rightButton)
      expect(scrollBySpy).toHaveBeenCalledTimes(1)
      fireEvent.click(leftButton)
      expect(scrollBySpy).toHaveBeenCalledTimes(2)
    })

    it('shadows a pinned edge only while content is hidden past it', () => {
      renderCard([createComponent()])
      act(() => deliverWidth?.(900))

      const typeHeader = screen.getByRole('columnheader', { name: 'Type' })
      const actionsHeader = screen.getByRole('columnheader', {
        name: 'Actions'
      })
      // The pinned header paints the header band rather than the page.
      expect(typeHeader).toHaveClass('sticky', 'left-0', STICKY_HEAD_CELL)
      expect(typeHeader.className).not.toContain(STICKY_LEFT_SHADOW)
      expect(actionsHeader.className).toContain(STICKY_RIGHT_SHADOW)

      const scroller = screen.getByRole('table').parentElement as HTMLElement
      act(() => {
        Object.defineProperty(scroller, 'scrollLeft', {
          configurable: true,
          value: 300
        })
        fireEvent.scroll(scroller)
      })

      expect(typeHeader.className).toContain(STICKY_LEFT_SHADOW)
      expect(actionsHeader).toHaveClass('sticky', 'right-0', STICKY_HEAD_CELL)
      expect(actionsHeader.className).not.toContain(STICKY_RIGHT_SHADOW)
    })
  })

  it('shows the empty state when there is nothing installed', () => {
    renderCard([])

    expect(screen.getByText('No components yet.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Add the parts you want to track and each one accrues distance from its added date.'
      )
    ).toBeInTheDocument()
  })

  it('renders the component row with its distance and dates', () => {
    renderCard([createComponent()])

    expect(screen.getByText('Chain')).toBeInTheDocument()
    expect(screen.getByText('Shimano')).toBeInTheDocument()
    expect(screen.getByText('HG701')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Product page: bike.shimano.com' })
    ).toHaveAttribute('href', 'https://bike.shimano.com/chain')
    expect(screen.getByText('2,450.0 km')).toBeInTheDocument()
    expect(screen.getByText('Jan 15, 2024')).toBeInTheDocument()
    // No removal date on an installed component.
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders an em dash when a component has no product page', () => {
    renderCard([createComponent({ productUrl: null })])

    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('renders "Since beginning" when a component has no added date', () => {
    renderCard([createComponent({ addedAt: null })])

    expect(screen.getByText('Since beginning')).toBeInTheDocument()
  })

  // A refitted part has more than one install period, and the gap between them
  // is the thing that must be visible: collapsed to a single window it reads as
  // having been on the bike the whole time, which is the misattribution the
  // periods exist to prevent. The two columns are a pair — line N of Added and
  // line N of Retired are the two ends of the same period.
  it('lists one line per install period on a refitted component', () => {
    renderCard([
      createComponent({
        addedAt: Date.UTC(2024, 0, 15),
        removedAt: null,
        periods: [
          { addedAt: Date.UTC(2024, 0, 15), removedAt: Date.UTC(2024, 5, 1) },
          { addedAt: Date.UTC(2024, 10, 20), removedAt: null }
        ]
      })
    ])

    expect(screen.getByText('Jan 15, 2024')).toBeInTheDocument()
    expect(screen.getByText('Jun 1, 2024')).toBeInTheDocument()
    expect(screen.getByText('Nov 20, 2024')).toBeInTheDocument()
    // Still fitted, so the second period has no end.
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  // The single-period case is every row that existed before install history and
  // every part that has never come off, so it must not grow a second line.
  it('renders one line per column for a component that has never been refitted', () => {
    renderCard([createComponent({ addedAt: Date.UTC(2024, 0, 15) })])

    expect(screen.getAllByText('Jan 15, 2024')).toHaveLength(1)
    expect(screen.getAllByText('—')).toHaveLength(1)
  })

  // Which Added line goes with which Retired line is carried by position, and a
  // screen reader reads the two columns separately — so the pairing has to be
  // in the text as well.
  it('numbers the install lines for a screen reader when a part has been refitted', () => {
    renderCard([
      createComponent({
        addedAt: Date.UTC(2024, 0, 15),
        removedAt: null,
        periods: [
          { addedAt: Date.UTC(2024, 0, 15), removedAt: Date.UTC(2024, 5, 1) },
          { addedAt: Date.UTC(2024, 10, 20), removedAt: null }
        ]
      })
    ])

    // Once per column, so each date is announced with the install it belongs to.
    // Anchored, so `Install 1:` does not also match `Install 10:` the day a
    // fixture grows that far — and anchored WITHOUT the trailing space the
    // element actually renders, because the default matcher normalizes
    // whitespace before comparing.
    expect(screen.getAllByText(/^Install 1:$/)).toHaveLength(2)
    expect(screen.getAllByText(/^Install 2:$/)).toHaveLength(2)
  })

  // A single-period row announces the bare date it always did — the numbering
  // exists to disambiguate a pairing, and there is none to disambiguate here.
  it('does not number the install line when there is only one', () => {
    renderCard([createComponent({ addedAt: Date.UTC(2024, 0, 15) })])

    expect(screen.queryByText(/^Install 1:$/)).toBeNull()
  })

  it.each([
    {
      description: 'renders the remaining interval below 85%',
      distanceMeters: 2000000,
      caption: 'of 5,000 km'
    },
    {
      description: 'warns at 85% of the interval',
      distanceMeters: 4300000,
      caption: 'due soon'
    },
    {
      description: 'flags an overdue service',
      distanceMeters: 5500000,
      caption: 'replace due'
    }
  ])('$description', ({ distanceMeters, caption }) => {
    renderCard([
      createComponent({ distanceMeters, serviceDistanceMeters: 5000000 })
    ])

    expect(screen.getByText(caption)).toBeInTheDocument()
  })

  it('renders no wear caption without a service interval', () => {
    renderCard([createComponent({ serviceDistanceMeters: null })])

    expect(screen.queryByText(/^of /)).not.toBeInTheDocument()
    expect(screen.queryByText('due soon')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('exposes the wear bar as a labelled progressbar', () => {
    renderCard([
      createComponent({
        distanceMeters: 2500000,
        serviceDistanceMeters: 5000000
      })
    ])

    const bar = screen.getByRole('progressbar', { name: 'Chain wear' })
    expect(bar).toHaveAttribute('aria-valuenow', '50')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar).toHaveAttribute('aria-valuetext', '50% of service interval')
  })

  it('caps an overdue progressbar at its maximum and reports the real wear', () => {
    renderCard([
      createComponent({
        distanceMeters: 9000000,
        serviceDistanceMeters: 5000000
      })
    ])

    const bar = screen.getByRole('progressbar', { name: 'Chain wear' })
    // aria-valuenow has to stay within min/max; the real number is the text.
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar).toHaveAttribute('aria-valuetext', '180% of service interval')
  })

  it('retires an installed component and refetches', async () => {
    const onChanged = renderCard([createComponent()])

    fireEvent.click(screen.getByRole('button', { name: 'Retire Chain' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm retire Chain' })
    )

    await waitFor(() =>
      expect(mockRetireFitnessGearComponent).toHaveBeenCalledWith(
        'gear-1',
        'component-1'
      )
    )
    expect(onChanged).toHaveBeenCalled()
  })

  // Retire closes the install window, so a stray click silently stops the part
  // accruing distance — and it takes reading the table closely to notice.
  it('does not retire on a single click', () => {
    renderCard([createComponent()])

    fireEvent.click(screen.getByRole('button', { name: 'Retire Chain' }))

    expect(mockRetireFitnessGearComponent).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Confirm retire Chain' })
    ).toBeInTheDocument()
  })

  it('disarms a pending retire when the button loses focus', () => {
    renderCard([createComponent()])

    const retire = screen.getByRole('button', { name: 'Retire Chain' })
    fireEvent.click(retire)
    fireEvent.blur(screen.getByRole('button', { name: 'Confirm retire Chain' }))

    expect(
      screen.getByRole('button', { name: 'Retire Chain' })
    ).toBeInTheDocument()
    expect(mockRetireFitnessGearComponent).not.toHaveBeenCalled()
  })

  it('arms only one retire at a time', () => {
    renderCard([
      createComponent(),
      createComponent({ id: 'component-2', componentType: 'Cassette' })
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Retire Chain' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retire Cassette' }))

    expect(
      screen.getByRole('button', { name: 'Retire Chain' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Confirm retire Cassette' })
    ).toBeInTheDocument()
  })

  // Two confirm ids let an arm survive the flip: a row armed for Delete, then
  // refitted, came back with Delete already armed — a one-click delete.
  it('does not carry an arm across refitting a row', async () => {
    mockRefitFitnessGearComponent.mockResolvedValue(
      createComponent({ removedAt: null })
    )
    renderCard([createComponent({ removedAt: Date.UTC(2025, 5, 1) })])

    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 retired component' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete Chain' }))
    expect(
      screen.getByRole('button', { name: 'Confirm delete Chain' })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Refit Chain' }))

    await waitFor(() =>
      expect(mockRefitFitnessGearComponent).toHaveBeenCalled()
    )
    // Nothing is armed once the row changes which action it offers.
    expect(
      screen.queryByRole('button', { name: 'Confirm delete Chain' })
    ).toBeNull()
  })

  // Refit posts to its own endpoint rather than clearing `removedAt` through
  // the generic PATCH: clearing it reopened the closed period, which credited
  // the part every activity ridden while it was off the bike.
  it('refits a retired component and refetches', async () => {
    const onChanged = renderCard([
      createComponent({ removedAt: Date.UTC(2025, 5, 1) })
    ])

    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 retired component' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refit Chain' }))

    await waitFor(() =>
      expect(mockRefitFitnessGearComponent).toHaveBeenCalledWith(
        'gear-1',
        'component-1'
      )
    )
    expect(onChanged).toHaveBeenCalled()
  })

  // Refit is not armed: it opens a new install period at today and leaves the
  // closed one alone, so a stray click costs nothing an immediate Retire does
  // not undo. Arming it would only add friction to the misclick recovery.
  it('refits on a single click', async () => {
    renderCard([createComponent({ removedAt: Date.UTC(2025, 5, 1) })])

    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 retired component' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refit Chain' }))

    await waitFor(() =>
      expect(mockRefitFitnessGearComponent).toHaveBeenCalled()
    )
  })

  it('surfaces a refit failure', async () => {
    mockRefitFitnessGearComponent.mockRejectedValue(
      new Error('Component not found')
    )
    const onChanged = renderCard([
      createComponent({ removedAt: Date.UTC(2025, 5, 1) })
    ])

    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 retired component' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refit Chain' }))

    expect(await screen.findByText('Component not found')).toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
  })

  // The pinned actions column fits two buttons, and "Confirm delete" beside
  // "Refit" did not: it spilled across the divider and off the card. The
  // accessible names still say what is being confirmed.
  it('labels an armed button "Confirm" and names what it confirms', () => {
    renderCard([
      createComponent(),
      createComponent({ id: 'c2', removedAt: Date.UTC(2025, 5, 1) })
    ])
    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 retired component' })
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retire Chain' }))
    expect(
      screen.getByRole('button', { name: 'Confirm retire Chain' })
    ).toHaveTextContent(/^Confirm$/)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Chain' }))
    expect(
      screen.getByRole('button', { name: 'Confirm delete Chain' })
    ).toHaveTextContent(/^Confirm$/)
  })

  it('offers refit and delete on a retired row, but not edit', () => {
    renderCard([createComponent({ removedAt: Date.UTC(2025, 5, 1) })])

    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 retired component' })
    )

    expect(screen.queryByRole('button', { name: 'Edit Chain' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Refit Chain' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Delete Chain' })
    ).toBeInTheDocument()
  })

  it('opens the edit dialog when Edit is clicked on an active component and updates', async () => {
    const onChanged = vi.fn()
    renderCard(
      [
        createComponent({
          componentType: 'Front tire',
          brand: 'Continental',
          model: '5000 AS TR'
        })
      ],
      onChanged
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit Front tire' }))

    expect(
      screen.getByRole('heading', { name: 'Edit component' })
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Brand')).toHaveValue('Continental')
    expect(screen.getByLabelText('Model')).toHaveValue('5000 AS TR')

    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'Grand Prix 5000' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mockUpdateFitnessGearComponent).toHaveBeenCalledWith(
        'gear-1',
        'component-1',
        expect.objectContaining({
          model: 'Grand Prix 5000'
        })
      )
    })
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('scopes the retire button accessible name to the component type', () => {
    renderCard([createComponent({ componentType: 'Fork' })])

    expect(
      screen.getByRole('button', { name: 'Retire Fork' })
    ).toBeInTheDocument()
  })

  it('hides retired components behind a toggle', () => {
    renderCard([
      createComponent(),
      createComponent({
        id: 'component-old',
        componentType: 'Cassette',
        removedAt: Date.UTC(2025, 5, 1)
      })
    ])

    expect(screen.queryByText('Cassette')).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 retired component' })
    )

    expect(screen.getByText('Cassette')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Hide retired components' })
    ).toBeInTheDocument()
  })

  it('pluralises the retired-components toggle', () => {
    renderCard([
      createComponent({ id: 'a', removedAt: 1 }),
      createComponent({ id: 'b', removedAt: 2 })
    ])

    expect(
      screen.getByRole('button', { name: 'Show 2 retired components' })
    ).toBeInTheDocument()
  })

  it('requires a second click to delete a retired component', async () => {
    const onChanged = renderCard([
      createComponent({ removedAt: Date.UTC(2025, 5, 1) })
    ])

    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 retired component' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete Chain' }))

    expect(mockDeleteFitnessGearComponent).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm delete Chain' })
    )

    await waitFor(() =>
      expect(mockDeleteFitnessGearComponent).toHaveBeenCalledWith(
        'gear-1',
        'component-1'
      )
    )
    expect(onChanged).toHaveBeenCalled()
  })

  it('disarms a pending delete when the retired rows are hidden and shown again', async () => {
    renderCard([createComponent({ removedAt: Date.UTC(2025, 5, 1) })])

    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 retired component' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete Chain' }))
    expect(
      screen.getByRole('button', { name: 'Confirm delete Chain' })
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Hide retired components' })
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 retired component' })
    )

    // The row comes back unarmed, so the next click confirms nothing.
    expect(
      screen.getByRole('button', { name: 'Delete Chain' })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Chain' }))
    expect(mockDeleteFitnessGearComponent).not.toHaveBeenCalled()
  })

  it('arms only one row at a time', () => {
    renderCard([
      createComponent({ id: 'component-a', removedAt: Date.UTC(2025, 5, 1) }),
      createComponent({
        id: 'component-b',
        componentType: 'Cassette',
        removedAt: Date.UTC(2025, 5, 2)
      })
    ])

    fireEvent.click(
      screen.getByRole('button', { name: 'Show 2 retired components' })
    )
    const rowA = screen.getByRole('button', { name: 'Delete Chain' })
    const rowB = screen.getByRole('button', { name: 'Delete Cassette' })

    fireEvent.click(rowA)
    expect(screen.getAllByRole('button', { name: /^Confirm delete/ })).toEqual([
      rowA
    ])

    fireEvent.click(rowB)
    expect(screen.getAllByRole('button', { name: /^Confirm delete/ })).toEqual([
      rowB
    ])
    expect(mockDeleteFitnessGearComponent).not.toHaveBeenCalled()
  })

  it('surfaces a retire failure', async () => {
    mockRetireFitnessGearComponent.mockRejectedValue(
      new Error('Component already retired')
    )
    const onChanged = renderCard([createComponent()])

    fireEvent.click(screen.getByRole('button', { name: 'Retire Chain' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm retire Chain' })
    )

    expect(
      await screen.findByText('Component already retired')
    ).toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
    // The row's own action comes back so the failure can be retried — still
    // armed, as Delete leaves itself, because the confirmation the user already
    // gave was not the thing that failed. Leaving the row disarms it either way.
    expect(
      screen.getByRole('button', { name: 'Confirm retire Chain' })
    ).toBeEnabled()
  })

  it('surfaces a delete failure', async () => {
    mockDeleteFitnessGearComponent.mockRejectedValue(
      new Error('Component not found')
    )
    const onChanged = renderCard([
      createComponent({ removedAt: Date.UTC(2025, 5, 1) })
    ])

    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 retired component' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete Chain' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm delete Chain' })
    )

    expect(await screen.findByText('Component not found')).toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('adds a component with no added date and no reminder', async () => {
    const onChanged = renderCard([])

    fireEvent.click(screen.getByRole('button', { name: 'Add component' }))
    fireEvent.change(screen.getByLabelText('Component type'), {
      target: { value: 'Cassette' }
    })
    fireEvent.change(screen.getByLabelText('Brand'), {
      target: { value: 'SRAM' }
    })
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'XG-1275' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save component' }))

    await waitFor(() =>
      expect(mockCreateFitnessGearComponent).toHaveBeenCalledTimes(1)
    )
    expect(mockCreateFitnessGearComponent).toHaveBeenCalledWith('gear-1', {
      componentType: 'Cassette',
      brand: 'SRAM',
      model: 'XG-1275',
      addedAt: undefined,
      serviceDistanceMeters: null,
      productUrl: null
    })
    expect(onChanged).toHaveBeenCalled()
  })

  it('sends the product URL when provided', async () => {
    renderCard([])

    fireEvent.click(screen.getByRole('button', { name: 'Add component' }))
    fireEvent.change(screen.getByLabelText('Product page'), {
      target: { value: 'https://bike.shimano.com/product/cn-hg701.html' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save component' }))

    await waitFor(() =>
      expect(mockCreateFitnessGearComponent).toHaveBeenCalledTimes(1)
    )
    expect(mockCreateFitnessGearComponent.mock.calls[0][1]).toMatchObject({
      productUrl: 'https://bike.shimano.com/product/cn-hg701.html'
    })
  })

  it('sends the added date and the service interval in meters', async () => {
    renderCard([])

    fireEvent.click(screen.getByRole('button', { name: 'Add component' }))
    fireEvent.change(screen.getByLabelText('Added on'), {
      target: { value: 'date' }
    })
    fireEvent.change(screen.getByLabelText('Added date'), {
      target: { value: '2024-03-01' }
    })
    fireEvent.change(screen.getByLabelText('Service reminder'), {
      target: { value: '5000' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save component' }))

    await waitFor(() =>
      expect(mockCreateFitnessGearComponent).toHaveBeenCalledTimes(1)
    )
    expect(mockCreateFitnessGearComponent.mock.calls[0][1]).toMatchObject({
      addedAt: Date.UTC(2024, 2, 1),
      serviceDistanceMeters: 5000000
    })
  })

  it('saves when the add panel is submitted from a text field', async () => {
    renderCard([])

    fireEvent.click(screen.getByRole('button', { name: 'Add component' }))
    fireEvent.change(screen.getByLabelText('Brand'), {
      target: { value: 'SRAM' }
    })
    // Enter in an input submits the form it belongs to; the panel used to be a
    // plain div, where the same key press did nothing at all.
    fireEvent.submit(screen.getByRole('form', { name: 'Add component' }))

    await waitFor(() =>
      expect(mockCreateFitnessGearComponent).toHaveBeenCalledTimes(1)
    )
    expect(mockCreateFitnessGearComponent.mock.calls[0][1]).toMatchObject({
      brand: 'SRAM'
    })
  })

  it('only shows the date input when "Specify date" is selected', () => {
    renderCard([])

    fireEvent.click(screen.getByRole('button', { name: 'Add component' }))
    expect(screen.queryByLabelText('Added date')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Added on'), {
      target: { value: 'date' }
    })
    const dateInput = screen.getByLabelText('Added date')
    expect(dateInput).toBeInTheDocument()
    expect(dateInput).toHaveAttribute('type', 'date')
    expect(dateInput).toHaveClass('appearance-none')
  })

  it('closes the add form on cancel', () => {
    renderCard([])

    fireEvent.click(screen.getByRole('button', { name: 'Add component' }))
    expect(screen.getByLabelText('Component type')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Component type')).not.toBeInTheDocument()
  })

  it('surfaces a save failure', async () => {
    mockCreateFitnessGearComponent.mockRejectedValue(
      new Error('Component type is required')
    )
    renderCard([])

    fireEvent.click(screen.getByRole('button', { name: 'Add component' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save component' }))

    await waitFor(() =>
      expect(screen.getByText('Component type is required')).toBeInTheDocument()
    )
  })

  // The retired-row dim has to sit on a descendant, not the pinned cell,
  // because `opacity` fades an element's background along with its text.
  describe('pinned first column', () => {
    const getTypeCell = (componentType: string) =>
      screen.getByText(componentType).closest('td')

    it('dims a retired component through its cells so the pinned column stays opaque', () => {
      renderCard([createComponent({ removedAt: Date.UTC(2025, 2, 15) })])

      fireEvent.click(
        screen.getByRole('button', { name: /^Show 1 retired component/ })
      )

      const cell = getTypeCell('Chain')
      expect(cell?.closest('tr')).not.toHaveClass('opacity-60')
      expect(cell).not.toHaveClass('opacity-60')
      expect(cell?.querySelector('.opacity-60')).not.toBeNull()
    })
  })
})
