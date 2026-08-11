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

import { getFitnessGearList } from '@/lib/client'
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

  it('surfaces a load failure', async () => {
    mockGetFitnessGearList.mockRejectedValue(new Error('Gear service down'))
    render(<GearListView />)

    await waitFor(() =>
      expect(screen.getByText('Gear service down')).toBeInTheDocument()
    )
  })
})
