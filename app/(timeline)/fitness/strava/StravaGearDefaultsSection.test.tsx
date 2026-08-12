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

import { getFitnessGearList, updateFitnessGear } from '@/lib/client'
import type { GearEntity } from '@/lib/services/fitness-gears/gearEntities'

import {
  StravaGearDefaultsSection,
  getDefaultRows,
  getGearOptionsForSport
} from './StravaGearDefaultsSection'

vi.mock('@/lib/client', () => ({
  getFitnessGearList: vi.fn(),
  updateFitnessGear: vi.fn()
}))

const mockGetFitnessGearList = getFitnessGearList as jest.MockedFunction<
  typeof getFitnessGearList
>
const mockUpdateFitnessGear = updateFitnessGear as jest.MockedFunction<
  typeof updateFitnessGear
>

const createGear = (overrides: Partial<GearEntity> = {}): GearEntity => ({
  id: 'gear-bike',
  kind: 'bike',
  name: 'Moots',
  brand: null,
  model: null,
  bikeType: null,
  weightKilograms: null,
  defaultSports: ['ride'],
  alertDistanceMeters: null,
  notes: null,
  retiredAt: null,
  createdAt: Date.UTC(2024, 0, 1),
  distanceMeters: 42_600,
  activityCount: 12,
  ...overrides
})

describe('getDefaultRows', () => {
  it('reads the mapping out of the gears that hold it', () => {
    const bike = createGear({ defaultSports: ['gravel_ride', 'ride'] })
    const shoes = createGear({
      id: 'gear-shoes',
      kind: 'shoes',
      name: 'Cloud',
      defaultSports: ['run']
    })

    expect(
      getDefaultRows([shoes, bike]).map((row) => [row.sportKey, row.gear.id])
      // Ordered by SPORT_KEYS, not by the order the gears came back in.
    ).toEqual([
      ['ride', 'gear-bike'],
      ['gravel_ride', 'gear-bike'],
      ['run', 'gear-shoes']
    ])
  })

  it('ignores a sport key this build does not know', () => {
    expect(getDefaultRows([createGear({ defaultSports: ['skiing'] })])).toEqual(
      []
    )
  })
})

describe('getGearOptionsForSport', () => {
  it('offers only active gear of the sport kind', () => {
    const bike = createGear()
    const retiredBike = createGear({ id: 'gear-old', retiredAt: 1 })
    const shoes = createGear({ id: 'gear-shoes', kind: 'shoes' })

    expect(
      getGearOptionsForSport([bike, retiredBike, shoes], 'ride').map(
        (gear) => gear.id
      )
    ).toEqual(['gear-bike'])
  })

  it('keeps the assigned gear listed even when it is retired', () => {
    // A picker that cannot represent its own value renders the assignment as
    // something else, which reads as the mapping having changed on its own.
    const bike = createGear()
    const retiredBike = createGear({ id: 'gear-old', retiredAt: 1 })

    expect(
      getGearOptionsForSport([bike, retiredBike], 'ride', 'gear-old').map(
        (gear) => gear.id
      )
    ).toEqual(['gear-old', 'gear-bike'])
  })
})

describe('StravaGearDefaultsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a row per mapped activity type', async () => {
    mockGetFitnessGearList.mockResolvedValue([
      createGear({ defaultSports: ['ride'] })
    ])

    render(<StravaGearDefaultsSection />)

    expect(await screen.findByLabelText('Ride')).toHaveValue('gear-bike')
  })

  it('points at the gear page when the shed is empty', async () => {
    mockGetFitnessGearList.mockResolvedValue([])

    render(<StravaGearDefaultsSection />)

    expect(
      await screen.findByRole('link', { name: 'Add a bike or a pair of shoes' })
    ).toHaveAttribute('href', '/fitness/gear')
  })

  it('adds the sport to the picked gear and re-reads the list', async () => {
    const bike = createGear({ defaultSports: ['ride'] })
    const other = createGear({ id: 'gear-other', name: 'Giant' })
    mockGetFitnessGearList.mockResolvedValue([bike, other])
    mockUpdateFitnessGear.mockResolvedValue(other)

    render(<StravaGearDefaultsSection />)

    fireEvent.change(await screen.findByLabelText('Ride'), {
      target: { value: 'gear-other' }
    })

    // Only the gear being pointed at is written: the database takes the sport
    // off whoever held it inside the same transaction.
    await waitFor(() =>
      expect(mockUpdateFitnessGear).toHaveBeenCalledWith('gear-other', {
        defaultSports: ['ride']
      })
    )
    expect(mockGetFitnessGearList).toHaveBeenCalledTimes(2)
  })

  it('removes the activity type from the gear that held it', async () => {
    const bike = createGear({ defaultSports: ['ride', 'gravel_ride'] })
    mockGetFitnessGearList.mockResolvedValue([bike])
    mockUpdateFitnessGear.mockResolvedValue(bike)

    render(<StravaGearDefaultsSection />)

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Ride' }))

    await waitFor(() =>
      expect(mockUpdateFitnessGear).toHaveBeenCalledWith('gear-bike', {
        defaultSports: ['gravel_ride']
      })
    )
  })

  it('assigns an unmapped activity type to a gear of its kind', async () => {
    const shoes = createGear({
      id: 'gear-shoes',
      kind: 'shoes',
      name: 'Cloud',
      defaultSports: []
    })
    mockGetFitnessGearList.mockResolvedValue([shoes])
    mockUpdateFitnessGear.mockResolvedValue(shoes)

    render(<StravaGearDefaultsSection />)

    fireEvent.change(await screen.findByLabelText('Add activity type'), {
      target: { value: 'run' }
    })

    await waitFor(() =>
      expect(mockUpdateFitnessGear).toHaveBeenCalledWith('gear-shoes', {
        defaultSports: ['run']
      })
    )
  })

  it('offers no activity type whose kind has no gear to point at', async () => {
    mockGetFitnessGearList.mockResolvedValue([
      createGear({ kind: 'shoes', defaultSports: [] })
    ])

    render(<StravaGearDefaultsSection />)

    const addSelect = await screen.findByLabelText('Add activity type')
    // Pointing "Ride" somewhere needs a bike, and there is none in this shed.
    expect(
      within(addSelect).queryByRole('option', { name: 'Ride' })
    ).not.toBeInTheDocument()
    expect(within(addSelect).getByRole('option', { name: 'Run' })).toBeDefined()
  })

  it('surfaces a failed save instead of showing the old value as saved', async () => {
    const bike = createGear({ defaultSports: ['ride'] })
    mockGetFitnessGearList.mockResolvedValue([bike])
    mockUpdateFitnessGear.mockRejectedValue(new Error('Failed to save gear.'))

    render(<StravaGearDefaultsSection />)

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Ride' }))

    expect(await screen.findByText('Failed to save gear.')).toBeVisible()
  })
})
