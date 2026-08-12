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

// Radix's DropdownMenu opens on ArrowDown from its trigger — the same way the
// activity page's gear picker is driven in `FitnessStatusDetail.test.tsx`.
const openMenu = async (triggerName: string | RegExp) => {
  fireEvent.keyDown(await screen.findByRole('button', { name: triggerName }), {
    key: 'ArrowDown'
  })
  return screen.findByRole('menu')
}

// Named from its content, so the accessible name carries the assignment too
// ("Ride: Moots · 42.6 km"); match on the prefix rather than pinning the value.
const gearTriggerFor = (sportLabel: string) => new RegExp(`^${sportLabel}:`)

describe('StravaGearDefaultsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a row per mapped activity type', async () => {
    mockGetFitnessGearList.mockResolvedValue([
      createGear({ defaultSports: ['ride'] })
    ])

    render(<StravaGearDefaultsSection />)

    expect(
      await screen.findByRole('button', { name: gearTriggerFor('Ride') })
    ).toHaveTextContent('Moots')
  })

  it('points at the gear page when the shed is empty', async () => {
    mockGetFitnessGearList.mockResolvedValue([])

    render(<StravaGearDefaultsSection />)

    expect(
      await screen.findByRole('link', { name: 'Add a bike or a pair of shoes' })
    ).toHaveAttribute('href', '/fitness/gear')
  })

  it('explains itself when every gear is retired instead of pointing at a control that is not there', async () => {
    // "Add an activity type below" is only honest when there is something
    // below, and the add control needs an active gear to point a type at.
    mockGetFitnessGearList.mockResolvedValue([
      createGear({ defaultSports: [], retiredAt: Date.UTC(2025, 0, 1) })
    ])

    render(<StravaGearDefaultsSection />)

    expect(
      await screen.findByText(/Every gear you have is retired/)
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /Add activity type/ })
    ).not.toBeInTheDocument()
  })

  it('moves the activity type onto the picked gear and shows it there', async () => {
    const moots = createGear({ defaultSports: ['ride'] })
    const giant = createGear({
      id: 'gear-other',
      name: 'Giant',
      defaultSports: []
    })
    // The two reads differ, because the write does not return what changed on
    // the OTHER gear: the server takes `ride` off Moots inside the same
    // transaction and only the re-read can see it. Returning one array for
    // both calls would let a component that never refetched pass this test.
    mockGetFitnessGearList
      .mockResolvedValueOnce([moots, giant])
      .mockResolvedValueOnce([
        { ...moots, defaultSports: [] },
        { ...giant, defaultSports: ['ride'] }
      ])
    mockUpdateFitnessGear.mockResolvedValue(giant)

    render(<StravaGearDefaultsSection />)

    const menu = await openMenu(gearTriggerFor('Ride'))
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Giant/ }))

    // Only the gear being pointed at is written.
    await waitFor(() =>
      expect(mockUpdateFitnessGear).toHaveBeenCalledWith('gear-other', {
        defaultSports: ['ride']
      })
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: gearTriggerFor('Ride') })
      ).toHaveTextContent('Giant')
    )
    expect(mockGetFitnessGearList).toHaveBeenCalledTimes(2)
  })

  it('does not write when the gear already assigned is picked again', async () => {
    // A `<select>` never fired `change` for that; every menu row fires
    // `onSelect`, and tapping the checked row to dismiss the menu is the
    // natural gesture.
    mockGetFitnessGearList.mockResolvedValue([
      createGear({ defaultSports: ['ride'] })
    ])

    render(<StravaGearDefaultsSection />)

    const menu = await openMenu(gearTriggerFor('Ride'))
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Moots/ }))

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(mockUpdateFitnessGear).not.toHaveBeenCalled()
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

    const menu = await openMenu(/Add activity type/)
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Run' }))

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

    const menu = await openMenu(/Add activity type/)
    // Pointing "Ride" somewhere needs a bike, and there is none in this shed.
    expect(
      within(menu).queryByRole('menuitem', { name: 'Ride' })
    ).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Run' })).toBeVisible()
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
