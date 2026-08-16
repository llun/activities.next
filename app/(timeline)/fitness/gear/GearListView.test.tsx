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

import { createFitnessGear, getFitnessGearList } from '@/lib/client'
import type { GearEntity } from '@/lib/services/fitness-gears/gearEntities'

import { GearListView } from './GearListView'

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
  const section = heading.closest('[data-slot="card"]')
  if (!section) throw new Error(`No card found for section ${title}`)
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

  it('shows the per-kind empty state when there is no gear', async () => {
    render(<GearListView />)

    expect(
      await screen.findByText(
        'No bikes yet. Add one and new activities will start counting toward it.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'No shoes yet. Add a pair and new activities will start counting toward it.'
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

  it('renders an em dash when a gear has no default sports', async () => {
    mockGetFitnessGearList.mockResolvedValue([
      createGear({ defaultSports: [] })
    ])
    render(<GearListView />)

    const bikes = await getSection('Bikes')
    expect(bikes.getByText('—')).toBeInTheDocument()
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
    let resolveRefetch: (gears: GearEntity[]) => void = () => {}
    mockGetFitnessGearList
      .mockResolvedValueOnce([
        createGear(),
        createGear({
          id: 'gear-retired',
          name: 'Old racer',
          retiredAt: Date.UTC(2023, 4, 1)
        })
      ])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefetch = resolve
          })
      )
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

    resolveRefetch([createGear()])
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

    it('renders an em dash when a device has no product page', async () => {
      mockGetFitnessGearList.mockResolvedValue([
        createDevice({ productUrl: null })
      ])
      render(<GearListView />)

      const section = await getSection('Devices')
      expect(section.getByText('—')).toBeInTheDocument()
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
      expect(section.queryByRole('button')).not.toBeInTheDocument()
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
      expect(
        bikes.getByText(
          'No bikes yet. Add one and new activities will start counting toward it.'
        )
      ).toBeInTheDocument()
      const shoes = await getSection('Shoes')
      expect(
        shoes.getByText(
          'No shoes yet. Add a pair and new activities will start counting toward it.'
        )
      ).toBeInTheDocument()
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
        expect(cell).toHaveClass('sticky', 'left-0', 'bg-card')

        // The header cell is pinned too, or it scrolls away from the column it
        // labels.
        const header = cell?.closest('table')?.querySelector('thead th')
        expect(header).toHaveClass('sticky', 'left-0', 'bg-card')
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
})
