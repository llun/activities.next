/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  createFitnessGearComponent,
  deleteFitnessGearComponent,
  refitFitnessGearComponent,
  retireFitnessGearComponent
} from '@/lib/client'
import type { GearComponentEntity } from '@/lib/services/fitness-gears/gearEntities'

import { GearComponentsCard } from './GearComponentsCard'

vi.mock('@/lib/client', () => ({
  createFitnessGearComponent: vi.fn(),
  deleteFitnessGearComponent: vi.fn(),
  refitFitnessGearComponent: vi.fn(),
  retireFitnessGearComponent: vi.fn()
}))

const mockCreateFitnessGearComponent =
  createFitnessGearComponent as jest.MockedFunction<
    typeof createFitnessGearComponent
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
  constructor(
    private readonly callback: (entries: ResizeObserverEntry[]) => void
  ) {}

  observe(target: Element) {
    deliverWidth = (width: number) => {
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

    it('gives a column the same width in its header and its body', () => {
      renderCard([createComponent(), createComponent({ id: 'c2' })])
      act(() => deliverWidth?.(390))

      // A header and body that disagree is how a pinned column ends up
      // straddling the boundary it is meant to hold.
      for (const index of [0, 1, 2]) {
        const widths = columnCells(index).map(
          (cell) => (cell as HTMLElement).style.width
        )
        expect(new Set(widths).size).toBe(1)
        expect(widths[0]).toBe(index === 0 ? '120px' : '270px')
      }
    })

    it('pins the type column and snaps the rest below the threshold', () => {
      renderCard([createComponent()])
      act(() => deliverWidth?.(390))

      const [typeHeader] = columnCells(0)
      expect(typeHeader).toHaveClass('sticky')
      const [, brandHeader] = screen.getAllByRole('columnheader')
      expect((brandHeader as HTMLElement).style.scrollSnapAlign).toBe('start')
      expect(screen.getByRole('table').parentElement).toHaveStyle({
        scrollSnapType: 'x mandatory',
        scrollPaddingLeft: '120px'
      })
    })

    it('leaves a wide table unsnapped, with the type column still pinned', () => {
      renderCard([createComponent()])
      act(() => deliverWidth?.(900))

      const [typeHeader] = columnCells(0)
      expect(typeHeader).toHaveClass('sticky')
      expect((typeHeader as HTMLElement).style.width).toBe('')
      const [, brandHeader] = screen.getAllByRole('columnheader')
      expect((brandHeader as HTMLElement).style.scrollSnapAlign).toBe('')
      expect(screen.getByRole('table').parentElement).not.toHaveStyle({
        scrollSnapType: 'x mandatory'
      })
    })
  })

  it('shows the empty state when there is nothing installed', () => {
    renderCard([])

    expect(
      screen.getByText(
        'No components yet. Add the parts you want to track and each one accrues distance from its added date.'
      )
    ).toBeInTheDocument()
  })

  it('renders the component row with its distance and dates', () => {
    renderCard([createComponent()])

    expect(screen.getByText('Chain')).toBeInTheDocument()
    expect(screen.getByText('Shimano')).toBeInTheDocument()
    expect(screen.getByText('HG701')).toBeInTheDocument()
    expect(screen.getByText('2,450.0 km')).toBeInTheDocument()
    expect(screen.getByText('Jan 15, 2024')).toBeInTheDocument()
    // No removal date on an installed component.
    expect(screen.getByText('—')).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(
      screen.getByRole('button', { name: 'Confirm delete' })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Refit Chain' }))

    await waitFor(() =>
      expect(mockRefitFitnessGearComponent).toHaveBeenCalled()
    )
    // Nothing is armed once the row changes which action it offers.
    expect(screen.queryByRole('button', { name: 'Confirm delete' })).toBeNull()
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

  // jsdom does no layout, so the wrap can only be asserted as the class that
  // produces it. Below GEAR_TABLE_SNAP_WIDTH `dataColumnStyle` returns a FIXED
  // panel, and an overhang there eats the value from the right and cannot be
  // scrolled to under `x mandatory` — so a retired row's two actions must be
  // able to wrap rather than spill.
  it('lets the retired row actions wrap instead of overflowing', () => {
    renderCard([createComponent({ removedAt: Date.UTC(2025, 5, 1) })])

    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 retired component' })
    )

    const actions = screen
      .getByRole('button', { name: 'Refit Chain' })
      .closest('div')
    // Both tokens: `flex-wrap` does nothing without `display: flex`, and the
    // enclosing `<td>` carries `whitespace-nowrap`, so a block container puts
    // the two buttons on one line and overhangs the panel instead of wrapping.
    expect(actions).toHaveClass('flex', 'flex-wrap')
  })

  it('offers both refit and delete on a retired row', () => {
    renderCard([createComponent({ removedAt: Date.UTC(2025, 5, 1) })])

    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 retired component' })
    )

    expect(
      screen.getByRole('button', { name: 'Refit Chain' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(mockDeleteFitnessGearComponent).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

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
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(
      screen.getByRole('button', { name: 'Confirm delete' })
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Hide retired components' })
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 retired component' })
    )

    // The row comes back unarmed, so the next click confirms nothing.
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
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
    const [rowA, rowB] = screen.getAllByRole('button', { name: 'Delete' })

    fireEvent.click(rowA)
    expect(
      screen.getAllByRole('button', { name: 'Confirm delete' })
    ).toHaveLength(1)

    fireEvent.click(rowB)
    const confirming = screen.getAllByRole('button', { name: 'Confirm delete' })
    expect(confirming).toHaveLength(1)
    expect(confirming[0]).toBe(rowB)
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
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

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
      serviceDistanceMeters: null
    })
    expect(onChanged).toHaveBeenCalled()
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
    expect(screen.getByLabelText('Added date')).toBeInTheDocument()
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

  // Mirrors the pinned-column guards in GearListView.test.tsx. This table's
  // rows are inert, so it uses the non-hover variant — and its retired-row dim
  // has to sit on a descendant, not the pinned cell, because `opacity` fades an
  // element's background along with its text.
  describe('pinned first column', () => {
    const getTypeCell = (componentType: string) =>
      screen.getByText(componentType).closest('td')

    it('pins the type column on an opaque surface', () => {
      renderCard([createComponent()])

      expect(getTypeCell('Chain')).toHaveClass('sticky', 'left-0', 'bg-card')
    })

    it('pins the type column header too', () => {
      renderCard([createComponent()])

      expect(screen.getByText('Type').closest('th')).toHaveClass(
        'sticky',
        'left-0',
        'bg-card'
      )
    })

    it('leaves the pinned cell unlit, since the rows are not clickable', () => {
      renderCard([createComponent()])

      // The hover variant belongs only on a row that has its own `hover:` and
      // the `group` class. These rows have neither, so it would never match —
      // but keeping it off them is what stops a later `group` on the row from
      // lighting this column alone.
      expect(getTypeCell('Chain')?.className).not.toContain('group-hover:')
    })

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
