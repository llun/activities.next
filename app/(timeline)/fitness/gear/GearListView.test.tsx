/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import {
  createFitnessGear,
  getFitnessGearList,
  updateFitnessGear
} from '@/lib/client'
import type { GearEntity } from '@/lib/services/fitness-gears/gearEntities'
import { createDeferred } from '@/lib/testing/deferred'

import { GearListView } from './GearListView'
import { STICKY_HEAD_CELL } from './gearUi'

vi.mock('@/lib/client', () => ({
  createFitnessGear: vi.fn(),
  getFitnessGearList: vi.fn(),
  updateFitnessGear: vi.fn()
}))

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush })
}))

// Radix's Switch (inside the shoes dialog) measures its thumb with
// ResizeObserver, which jsdom does not implement.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const mockCreateFitnessGear = createFitnessGear as jest.MockedFunction<
  typeof createFitnessGear
>
const mockGetFitnessGearList = getFitnessGearList as jest.MockedFunction<
  typeof getFitnessGearList
>
const mockUpdateFitnessGear = updateFitnessGear as jest.MockedFunction<
  typeof updateFitnessGear
>

const createGear = (overrides: Partial<GearEntity> = {}): GearEntity => ({
  id: 'gear-1',
  kind: 'bike',
  name: 'Rocket',
  brand: 'Canyon',
  model: 'Endurace',
  bikeType: 'Road bike',
  weightKilograms: 8.1,
  defaultSports: ['ride'],
  alertDistanceMeters: null,
  notes: null,
  retiredAt: null,
  createdAt: Date.UTC(2018, 10, 27),
  distanceMeters: 35253700,
  activityCount: 1204,
  productUrl: null,
  firstUsedAt: null,
  ...overrides
})

const createDevice = (overrides: Partial<GearEntity> = {}): GearEntity =>
  createGear({
    id: 'device-1',
    kind: 'device',
    name: 'Garmin Edge 840',
    brand: 'Garmin',
    model: 'Edge 840',
    bikeType: null,
    weightKilograms: null,
    defaultSports: [],
    distanceMeters: 0,
    activityCount: 412,
    productUrl: 'https://www.garmin.com',
    firstUsedAt: Date.UTC(2023, 4, 2),
    ...overrides
  })

const getSection = async (title: string) => {
  const heading = await screen.findByRole('heading', { name: title })
  const section = heading.closest('section')
  if (!section) throw new Error(`No section found for ${title}`)
  return within(section as HTMLElement)
}

describe('GearListView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    mockGetFitnessGearList.mockResolvedValue([])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders a bikes section and a shoes section', async () => {
    render(<GearListView />)

    expect(
      await screen.findByRole('heading', { name: 'Bikes' })
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Shoes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add bike' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Add shoes' })
    ).toBeInTheDocument()
  })

  // jsdom lays nothing out, so this guards the containing block instead of
  // the page width: the "Actions" header and a narrow table's hidden "Edit" text
  // are `sr-only` (`position: absolute`) in cells that are not positioned, and
  // without a positioned scroller they escaped its overflow clip and widened
  // a 390px document to ~560px.
  it('keeps every table in a positioned scroller', async () => {
    mockGetFitnessGearList.mockResolvedValue([createGear(), createDevice()])
    render(<GearListView />)

    await screen.findByText('Rocket')
    const tables = screen.getAllByRole('table')
    expect(tables).toHaveLength(2)
    for (const table of tables) {
      expect(table.parentElement).toHaveClass('relative', 'overflow-x-auto')
    }
  })

  it('shows the per-kind empty state when there is no gear', async () => {
    render(<GearListView />)

    expect(await screen.findByText('No bikes yet.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Add one and new activities will start counting toward it.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('No shoes yet.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Add a pair and new activities will start counting toward it.'
      )
    ).toBeInTheDocument()
  })

  it('renders the name, the brand and model subline, the sports and the distance', async () => {
    mockGetFitnessGearList.mockResolvedValue([
      createGear({ defaultSports: ['ride', 'gravel_ride'] })
    ])
    render(<GearListView />)

    const bikes = await getSection('Bikes')
    expect(bikes.getByRole('link', { name: 'Rocket' })).toHaveAttribute(
      'href',
      '/fitness/gear/gear-1'
    )
    expect(bikes.getByText('Canyon · Endurace')).toBeInTheDocument()
    expect(bikes.getByText('Ride, Gravel ride')).toBeInTheDocument()
    expect(bikes.getByText('35,253.7 km')).toBeInTheDocument()
    expect(bikes.getByText('1 active')).toBeInTheDocument()
  })

  it('keeps the Default sports header and the distance on one line at a narrow card', async () => {
    mockGetFitnessGearList.mockResolvedValue([createGear()])
    render(<GearListView />)

    const bikes = await getSection('Bikes')
    // jsdom has no layout, so pin what keeps them on one line: at the design's
    // 590pt card the 12% Distance column was 71pt wide, wrapping "0.0 km" and the
    // two-word header into two lines each.
    expect(
      bikes.getByRole('columnheader', { name: 'Default sports' })
    ).toHaveClass('whitespace-nowrap')
    expect(bikes.getByText('35,253.7 km')).toHaveClass('whitespace-nowrap')
  })

  it('splits the bikes table into columns that add up to a full row, Distance wide enough for a lifetime total', async () => {
    mockGetFitnessGearList.mockResolvedValue([createGear()])
    render(<GearListView />)

    const bikes = await getSection('Bikes')
    const table = bikes.getByRole('table')
    const widths = Array.from(table.querySelectorAll('col')).map((col) => {
      const match = /w-\[([\d.]+)%\]/.exec(col.className)
      return match ? Number(match[1]) : NaN
    })

    expect(widths).toHaveLength(5)
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100)
    // Bike, Product page, Default sports, Distance, actions. Distance (a
    // five-digit total like "35,670.2 km") is the widest data cell after the
    // name, so it must out-size the Default sports column it used to be
    // smaller than.
    const [, , defaultSports, distance] = widths
    expect(distance).toBeGreaterThan(defaultSports)
  })

  // The three tables are meant to line up: the same first two columns and the
  // same Actions column, and the number each one right-aligns ends at 90% (the
  // Distance column of bikes and shoes, the Activities column of devices). The
  // devices table used to carry 34 / 26 / 30 / 10, so its Product page started
  // 0.5% left of the other two and its count ended 4% further left.
  it('lines the devices table up with the bikes and shoes tables', async () => {
    mockGetFitnessGearList.mockResolvedValue([
      createGear(),
      createGear({ id: 'gear-2', kind: 'shoes', name: 'Cloudmonster' }),
      createDevice()
    ])
    render(<GearListView />)

    const getWidths = async (title: string) => {
      const section = await getSection(title)
      return Array.from(section.getByRole('table').querySelectorAll('col')).map(
        (col) => {
          const match = /w-\[([\d.]+)%\]/.exec(col.className)
          return match ? Number(match[1]) : NaN
        }
      )
    }
    const bikes = await getWidths('Bikes')
    const shoes = await getWidths('Shoes')
    const devices = await getWidths('Devices')

    expect(devices).toEqual([33.5, 22.5, 34, 10])
    expect(shoes).toEqual(bikes)
    // Name, Product page and Actions are the same columns on all three.
    expect(devices[0]).toBe(bikes[0])
    expect(devices[1]).toBe(bikes[1])
    expect(devices[3]).toBe(bikes[4])
    // The count's right edge is the Distance column's: 90% in and 10% to go.
    const edge = (widths: number[]) =>
      widths.slice(0, -1).reduce((sum, width) => sum + width, 0)
    expect(edge(devices)).toBeCloseTo(edge(bikes))
    expect(devices.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100)
  })

  // jsdom lays nothing out, so none of this can measure the button: it pins the
  // classes that decide it. At 800px the table is 694px, the Actions column (10%)
  // 69px, and the old `px-3 pr-4` cell left 41px of content for a 62.5px
  // "pencil + Edit" button, which overflowed the table by 5px (14px at 640px).
  describe('Actions column', () => {
    // A bike, a retired bike (revealed) and a device: the bikes table and the
    // devices table, which render their own Actions cells.
    const renderTables = async () => {
      mockGetFitnessGearList.mockResolvedValue([
        createGear(),
        createGear({
          id: 'gear-retired',
          name: 'Old racer',
          retiredAt: Date.UTC(2023, 4, 1)
        }),
        createDevice()
      ])
      render(<GearListView />)

      const bikes = await getSection('Bikes')
      fireEvent.click(
        bikes.getByRole('button', { name: 'Show 1 retired bike' })
      )
    }

    const getEditButtons = () =>
      screen.getAllByRole('button', { name: /^Edit / })

    it('centres the button in symmetric padding on every table', async () => {
      await renderTables()

      const buttons = getEditButtons()
      expect(buttons).toHaveLength(3)
      for (const button of buttons) {
        const cell = button.closest('td') as HTMLElement
        // Symmetric `px-2`, as the components table's pinned actions: the old
        // `px-3 pr-4` took 28px of a 56px column, and `text-right` aligned the
        // button to what was left.
        expect(cell).toHaveClass('px-2')
        expect(cell).not.toHaveClass('pr-4')
        expect(cell).not.toHaveClass('text-right')
        expect(button.parentElement).toHaveClass(
          'flex',
          'w-full',
          'justify-center'
        )
      }
      const headers = screen.getAllByRole('columnheader', { name: 'Actions' })
      expect(headers).toHaveLength(2)
      for (const header of headers) {
        expect(header).toHaveClass('px-2')
        expect(header).not.toHaveClass('pr-4')
      }
    })

    // The column is 10% of the table, so the label's room depends on how wide
    // the TABLE is, which a viewport breakpoint cannot say: the table follows the
    // page's side navigation, so `sm:` showed the label from a 640px viewport,
    // on a 606px table whose Actions column could not hold it.
    it('shows the Edit label only where its own cell has the room, by container query', async () => {
      await renderTables()

      for (const button of getEditButtons()) {
        const label = within(button).getByText('Edit')
        expect(label).toHaveClass('sr-only', '@min-[4rem]:not-sr-only')
        expect(label.className).not.toMatch(/(^|\s)sm:/)
        // The container is the wrapper around the button, which is as wide as the
        // cell's content; the cell itself cannot be a size container.
        expect(button.parentElement).toHaveClass('@container')
        expect(button.closest('td')).not.toHaveClass('@container')
        // The pencil is always there, and the accessible name never changes.
        expect(button.querySelector('svg')).toBeInTheDocument()
      }
    })

    it("dims a retired row's Actions cell with the rest of the row, and only that one", async () => {
      await renderTables()

      const cellOf = (name: string) =>
        screen.getByRole('button', { name }).closest('td') as HTMLElement
      expect(cellOf('Edit Old racer')).toHaveClass('opacity-60')
      expect(cellOf('Edit Rocket')).not.toHaveClass('opacity-60')
      expect(cellOf('Edit Garmin Edge 840')).not.toHaveClass('opacity-60')
    })
  })

  it('renders an em dash when a gear has no default sports', async () => {
    mockGetFitnessGearList.mockResolvedValue([
      createGear({
        defaultSports: [],
        productUrl: 'https://www.canyon.com'
      })
    ])
    render(<GearListView />)

    const bikes = await getSection('Bikes')
    expect(bikes.getByText('—')).toBeInTheDocument()
  })

  it('renders product page link for bikes and shoes', async () => {
    mockGetFitnessGearList.mockResolvedValue([
      createGear({ productUrl: 'https://www.canyon.com/endurace' }),
      createGear({
        id: 'gear-2',
        kind: 'shoes',
        name: 'Cloudmonster',
        productUrl: 'https://www.on.com/cloudmonster'
      })
    ])
    render(<GearListView />)

    const bikes = await getSection('Bikes')
    expect(
      bikes.getByRole('link', { name: 'Product page: canyon.com' })
    ).toHaveAttribute('href', 'https://www.canyon.com/endurace')

    const shoes = await getSection('Shoes')
    expect(
      shoes.getByRole('link', { name: 'Product page: on.com' })
    ).toHaveAttribute('href', 'https://www.on.com/cloudmonster')
  })

  it('separates shoes from bikes', async () => {
    mockGetFitnessGearList.mockResolvedValue([
      createGear(),
      createGear({
        id: 'gear-2',
        kind: 'shoes',
        name: 'Cloudmonster',
        brand: 'On',
        model: 'Cloudmonster',
        bikeType: null,
        weightKilograms: null,
        defaultSports: ['run'],
        alertDistanceMeters: 650000,
        distanceMeters: 412300
      })
    ])
    render(<GearListView />)

    const shoes = await getSection('Shoes')
    expect(
      shoes.getByRole('link', { name: 'Cloudmonster' })
    ).toBeInTheDocument()
    expect(
      shoes.queryByRole('link', { name: 'Rocket' })
    ).not.toBeInTheDocument()

    const bikes = await getSection('Bikes')
    expect(
      bikes.queryByRole('link', { name: 'Cloudmonster' })
    ).not.toBeInTheDocument()
  })

  it('hides retired gear until the toggle is used and excludes it from the active count', async () => {
    mockGetFitnessGearList.mockResolvedValue([
      createGear(),
      createGear({
        id: 'gear-retired',
        name: 'Old racer',
        retiredAt: Date.UTC(2023, 4, 1)
      })
    ])
    render(<GearListView />)

    const bikes = await getSection('Bikes')
    expect(bikes.getByText('1 active')).toBeInTheDocument()
    expect(
      bikes.queryByRole('link', { name: 'Old racer' })
    ).not.toBeInTheDocument()

    fireEvent.click(bikes.getByRole('button', { name: 'Show 1 retired bike' }))

    expect(bikes.getByRole('link', { name: 'Old racer' })).toBeInTheDocument()
    expect(bikes.getByText('retired')).toBeInTheDocument()
    expect(
      bikes.getByRole('button', { name: 'Hide retired bikes' })
    ).toBeInTheDocument()
  })

  it('pluralises the retired toggle count', async () => {
    mockGetFitnessGearList.mockResolvedValue([
      createGear({ id: 'r1', retiredAt: 1 }),
      createGear({ id: 'r2', retiredAt: 2 })
    ])
    render(<GearListView />)

    const bikes = await getSection('Bikes')
    expect(
      bikes.getByRole('button', { name: 'Show 2 retired bikes' })
    ).toBeInTheDocument()
  })

  it('counts retired shoes as pairs', async () => {
    mockGetFitnessGearList.mockResolvedValue([
      createGear({ id: 's1', kind: 'shoes', retiredAt: 1 })
    ])
    render(<GearListView />)

    const shoes = await getSection('Shoes')
    expect(
      shoes.getByRole('button', { name: 'Show 1 retired pair of shoes' })
    ).toBeInTheDocument()
  })

  it('navigates to the gear detail page when a row is clicked', async () => {
    mockGetFitnessGearList.mockResolvedValue([createGear()])
    render(<GearListView />)

    const bikes = await getSection('Bikes')
    fireEvent.click(bikes.getByText('Canyon · Endurace'))

    expect(mockPush).toHaveBeenCalledWith('/fitness/gear/gear-1')
  })

  it('opens the add dialog with the section kind', async () => {
    render(<GearListView />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add shoes' }))

    expect(
      await screen.findByRole('heading', { name: 'Add shoes' })
    ).toBeInTheDocument()
    // Shoes carry an alert distance, never a frame type.
    expect(screen.getByText('Distance alert')).toBeInTheDocument()
    expect(screen.queryByLabelText('Weight (kg)')).not.toBeInTheDocument()
  })

  it('refetches the list after a new bike is saved', async () => {
    mockCreateFitnessGear.mockResolvedValue(createGear())
    render(<GearListView />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add bike' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save bike' }))

    await waitFor(() => expect(mockCreateFitnessGear).toHaveBeenCalledTimes(1))
    // Distances and the one-gear-per-sport defaults are derived server-side,
    // so the saved gear is read back rather than patched in locally.
    await waitFor(() => expect(mockGetFitnessGearList).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Add a bike' })
      ).not.toBeInTheDocument()
    )
  })

  it('keeps the sections rendered while a refetch is in flight', async () => {
    mockCreateFitnessGear.mockResolvedValue(createGear())
    const deferred = createDeferred<GearEntity[]>()
    mockGetFitnessGearList
      .mockResolvedValueOnce([
        createGear(),
        createGear({
          id: 'gear-retired',
          name: 'Old racer',
          retiredAt: Date.UTC(2023, 4, 1)
        })
      ])
      .mockImplementationOnce(() => deferred.promise)
    render(<GearListView />)

    // The expanded retired list is the state a "Loading..." swap would lose.
    fireEvent.click(
      await screen.findByRole('button', { name: 'Show 1 retired bike' })
    )
    expect(screen.getByRole('link', { name: 'Old racer' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add bike' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save bike' }))

    await waitFor(() => expect(mockGetFitnessGearList).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Rocket' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Old racer' })).toBeInTheDocument()

    deferred.resolve([createGear()])
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: 'Old racer' })
      ).not.toBeInTheDocument()
    )
  })

  it('surfaces a load failure', async () => {
    mockGetFitnessGearList.mockRejectedValue(new Error('Gear service down'))
    render(<GearListView />)

    await waitFor(() =>
      expect(screen.getByText('Gear service down')).toBeInTheDocument()
    )
  })

  describe('devices', () => {
    it('renders a devices card with a count, the product host and the activity count', async () => {
      mockGetFitnessGearList.mockResolvedValue([createGear(), createDevice()])
      render(<GearListView />)

      const section = await getSection('Devices')
      expect(section.getByText('1 recording')).toBeInTheDocument()
      expect(
        section.getByRole('link', { name: 'Garmin Edge 840' })
      ).toBeInTheDocument()
      expect(section.getByText('Garmin · Edge 840')).toBeInTheDocument()
      expect(section.getByText('412')).toBeInTheDocument()

      const productLink = section.getByRole('link', {
        name: 'Product page: garmin.com'
      })
      expect(productLink).toHaveAttribute('href', 'https://www.garmin.com')
      expect(productLink).toHaveAttribute('target', '_blank')
    })

    it('offers to add a product page when a device has none', async () => {
      mockGetFitnessGearList.mockResolvedValue([
        createDevice({ productUrl: null })
      ])
      render(<GearListView />)

      const section = await getSection('Devices')
      expect(
        section.getByRole('button', { name: 'No product page — add one' })
      ).toBeInTheDocument()
    })

    it('hides the card entirely when the actor has no devices', async () => {
      // Nothing to explain and nothing to add — devices arrive with the
      // activities that recorded them.
      mockGetFitnessGearList.mockResolvedValue([createGear()])
      render(<GearListView />)

      await screen.findByRole('heading', { name: 'Bikes' })
      expect(
        screen.queryByRole('heading', { name: 'Devices' })
      ).not.toBeInTheDocument()
    })

    it('offers no Add button and no retired toggle', async () => {
      mockGetFitnessGearList.mockResolvedValue([createDevice()])
      render(<GearListView />)

      const section = await getSection('Devices')
      expect(
        section.queryByRole('button', { name: /Add/ })
      ).not.toBeInTheDocument()
      expect(
        section.queryByRole('button', { name: /retired/i })
      ).not.toBeInTheDocument()
    })

    it('navigates to the device page when a row is clicked', async () => {
      mockGetFitnessGearList.mockResolvedValue([createDevice()])
      render(<GearListView />)

      const section = await getSection('Devices')
      fireEvent.click(section.getByText('Garmin · Edge 840'))
      expect(mockPush).toHaveBeenCalledWith('/fitness/gear/device-1')
    })

    it('does not navigate the row when the product link is clicked', async () => {
      // The row navigates on click and the link is inside it, so without the
      // `onClick` guard GearListView passes to GearProductLink a click would
      // open the vendor's page AND push the device route behind it.
      mockGetFitnessGearList.mockResolvedValue([createDevice()])
      render(<GearListView />)

      const section = await getSection('Devices')
      fireEvent.click(
        section.getByRole('link', { name: 'Product page: garmin.com' })
      )

      expect(mockPush).not.toHaveBeenCalled()
    })

    it('keeps devices out of the bikes and shoes sections', async () => {
      mockGetFitnessGearList.mockResolvedValue([createDevice()])
      render(<GearListView />)

      const bikes = await getSection('Bikes')
      expect(bikes.getByText('No bikes yet.')).toBeInTheDocument()
      const shoes = await getSection('Shoes')
      expect(shoes.getByText('No shoes yet.')).toBeInTheDocument()
    })
  })

  // The pinned first column fails silently: drop its opaque surface and the
  // scrolled-under columns show through it, drop `group` from the row and only
  // that column lights on hover, and a translucent hover reintroduces the
  // transparency. None of those produce a type error, a lint error or a visual
  // diff in the tests that follow — so they are asserted directly.
  describe('pinned first column', () => {
    const sections: [string, string, () => GearEntity][] = [
      ['Bikes', 'Rocket', () => createGear()],
      [
        'Shoes',
        'Speedgoat',
        () => createGear({ id: 'gear-2', kind: 'shoes', name: 'Speedgoat' })
      ],
      ['Devices', 'Garmin Edge 840', () => createDevice()]
    ]

    it.each(sections)(
      'pins the first column of the %s table on an opaque surface',
      async (title, rowName, makeGear) => {
        mockGetFitnessGearList.mockResolvedValue([makeGear()])
        render(<GearListView />)

        const section = await getSection(title)
        const cell = section.getByRole('link', { name: rowName }).closest('td')
        // The page's own surface: the table sits on the page, not in a card.
        expect(cell).toHaveClass('sticky', 'left-0', 'bg-background')

        // The header cell is pinned too, or it scrolls away from the column it
        // labels, and paints the header band opaque rather than the page.
        const header = cell?.closest('table')?.querySelector('thead th')
        expect(header).toHaveClass('sticky', 'left-0', STICKY_HEAD_CELL)
        expect(header).not.toHaveClass('bg-background')
      }
    )

    it.each(sections)(
      'lights the whole %s row on hover, not just its pinned column',
      async (title, rowName, makeGear) => {
        mockGetFitnessGearList.mockResolvedValue([makeGear()])
        render(<GearListView />)

        const section = await getSection(title)
        const cell = section.getByRole('link', { name: rowName }).closest('td')
        const row = cell?.closest('tr')

        // The pinned cell paints over the row's background, so it repeats the
        // row's hover — which only works if the row is the `group`, and only
        // stays opaque if both use the same unmodified colour.
        expect(row).toHaveClass('group', 'hover:bg-muted')
        expect(cell).toHaveClass('group-hover:bg-muted')
        expect(cell?.className).not.toMatch(/bg-muted\//)
      }
    )

    it('dims a retired row through its cells so the pinned column stays opaque', async () => {
      mockGetFitnessGearList.mockResolvedValue([
        createGear({ retiredAt: Date.UTC(2020, 0, 1) })
      ])
      render(<GearListView />)

      const section = await getSection('Bikes')
      const toggle = section.getByRole('button', { name: /^Show 1 retired/ })
      fireEvent.click(toggle)

      const cell = section.getByRole('link', { name: 'Rocket' }).closest('td')
      expect(cell?.closest('tr')).not.toHaveClass('opacity-60')
      expect(cell).not.toHaveClass('opacity-60')
      expect(cell?.querySelector('.opacity-60')).not.toBeNull()
    })
  })

  describe('editing gear', () => {
    it('opens the edit dialog seeded with the gear when Edit is clicked on an active bike', async () => {
      mockGetFitnessGearList.mockResolvedValue([createGear()])
      render(<GearListView />)

      const section = await getSection('Bikes')
      fireEvent.click(section.getByRole('button', { name: 'Edit Rocket' }))

      expect(
        await screen.findByRole('heading', { name: 'Edit bike' })
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Brand')).toHaveValue('Canyon')
      expect(screen.getByLabelText('Model')).toHaveValue('Endurace')
      expect(screen.getByLabelText('Nickname')).toHaveValue('Rocket')
    })

    it('updates gear nickname and product URL and refetches the list when saved', async () => {
      mockGetFitnessGearList.mockResolvedValue([createGear()])
      mockUpdateFitnessGear.mockResolvedValue(
        createGear({
          name: 'Speedster',
          productUrl: 'https://canyon.com/speed'
        })
      )
      render(<GearListView />)

      const section = await getSection('Bikes')
      fireEvent.click(section.getByRole('button', { name: 'Edit Rocket' }))

      const nicknameInput = await screen.findByLabelText('Nickname')
      fireEvent.change(nicknameInput, { target: { value: 'Speedster' } })

      const urlInput = screen.getByLabelText('Product page')
      fireEvent.change(urlInput, {
        target: { value: 'https://canyon.com/speed' }
      })

      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      await waitFor(() =>
        expect(mockUpdateFitnessGear).toHaveBeenCalledTimes(1)
      )
      expect(mockUpdateFitnessGear).toHaveBeenCalledWith('gear-1', {
        alertDistanceMeters: null,
        bikeType: 'Road bike',
        brand: 'Canyon',
        defaultSports: ['ride'],
        model: 'Endurace',
        name: 'Speedster',
        notes: null,
        productUrl: 'https://canyon.com/speed',
        weightKilograms: 8.1
      })
      await waitFor(() =>
        expect(mockGetFitnessGearList).toHaveBeenCalledTimes(2)
      )
    })

    it('opens the edit dialog when Edit is clicked on a retired bike', async () => {
      mockGetFitnessGearList.mockResolvedValue([
        createGear({
          id: 'gear-retired',
          name: 'Old racer',
          retiredAt: Date.UTC(2023, 4, 1)
        })
      ])
      render(<GearListView />)

      const section = await getSection('Bikes')
      fireEvent.click(
        section.getByRole('button', { name: 'Show 1 retired bike' })
      )
      fireEvent.click(section.getByRole('button', { name: 'Edit Old racer' }))

      expect(
        await screen.findByRole('heading', { name: 'Edit bike' })
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Nickname')).toHaveValue('Old racer')
    })

    it('opens the edit dialog when Edit is clicked on a device and saves updates', async () => {
      mockGetFitnessGearList.mockResolvedValue([createDevice()])
      mockUpdateFitnessGear.mockResolvedValue(
        createDevice({
          name: 'My Garmin',
          productUrl: 'https://garmin.com/custom'
        })
      )
      render(<GearListView />)

      const section = await getSection('Devices')
      fireEvent.click(
        section.getByRole('button', { name: 'Edit Garmin Edge 840' })
      )

      expect(
        await screen.findByRole('heading', { name: 'Edit device' })
      ).toBeInTheDocument()

      const nicknameInput = screen.getByLabelText('Nickname')
      fireEvent.change(nicknameInput, { target: { value: 'My Garmin' } })

      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      await waitFor(() =>
        expect(mockUpdateFitnessGear).toHaveBeenCalledTimes(1)
      )
      expect(mockUpdateFitnessGear).toHaveBeenCalledWith('device-1', {
        brand: 'Garmin',
        model: 'Edge 840',
        name: 'My Garmin',
        productUrl: 'https://www.garmin.com'
      })
      await waitFor(() =>
        expect(mockGetFitnessGearList).toHaveBeenCalledTimes(2)
      )
    })

    it('does not navigate the row when Edit or No product page is clicked', async () => {
      mockGetFitnessGearList.mockResolvedValue([
        createGear({ productUrl: null })
      ])
      render(<GearListView />)

      const section = await getSection('Bikes')

      fireEvent.click(
        section.getByRole('button', { name: 'No product page — add one' })
      )
      expect(mockPush).not.toHaveBeenCalled()
      expect(
        await screen.findByRole('heading', { name: 'Edit bike' })
      ).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      fireEvent.click(section.getByRole('button', { name: 'Edit Rocket' }))
      expect(mockPush).not.toHaveBeenCalled()
    })
  })
})
