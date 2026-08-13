/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  getFitnessGearComponents,
  getFitnessGearList,
  setFitnessGearRetired
} from '@/lib/client'
import type {
  GearComponentEntity,
  GearEntity
} from '@/lib/services/fitness-gears/gearEntities'

import { GearDetailView } from './GearDetailView'

vi.mock('@/lib/client', () => ({
  createFitnessGear: vi.fn(),
  getFitnessGearActivities: vi.fn().mockResolvedValue({
    activities: [],
    hasMore: false
  }),
  createFitnessGearComponent: vi.fn(),
  deleteFitnessGearComponent: vi.fn(),
  getFitnessGearComponents: vi.fn(),
  getFitnessGearList: vi.fn(),
  replaceFitnessGearComponent: vi.fn(),
  setFitnessGearRetired: vi.fn(),
  updateFitnessGear: vi.fn()
}))

// Radix's Switch (inside the shoes edit dialog) needs ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const mockGetFitnessGearComponents =
  getFitnessGearComponents as jest.MockedFunction<
    typeof getFitnessGearComponents
  >
const mockGetFitnessGearList = getFitnessGearList as jest.MockedFunction<
  typeof getFitnessGearList
>
const mockSetFitnessGearRetired = setFitnessGearRetired as jest.MockedFunction<
  typeof setFitnessGearRetired
>

const createGear = (overrides: Partial<GearEntity> = {}): GearEntity => ({
  id: 'gear-1',
  kind: 'bike',
  name: 'Rocket',
  brand: 'Canyon',
  model: 'Endurace',
  bikeType: 'Road bike',
  weightKilograms: 8.1,
  defaultSports: ['ride', 'gravel_ride'],
  alertDistanceMeters: null,
  notes: null,
  retiredAt: null,
  createdAt: Date.UTC(2018, 10, 27, 12),
  distanceMeters: 35253700,
  activityCount: 1204,
  productUrl: null,
  firstUsedAt: null,
  ...overrides
})

const createComponent = (
  overrides: Partial<GearComponentEntity> = {}
): GearComponentEntity => ({
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
})

describe('GearDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    mockGetFitnessGearList.mockResolvedValue([createGear()])
    mockGetFitnessGearComponents.mockResolvedValue([])
    mockSetFitnessGearRetired.mockResolvedValue(createGear())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the gear name as the page title with a back link', async () => {
    render(<GearDetailView gearId="gear-1" actorHandle="@test@llun.test" />)

    expect(
      await screen.findByRole('heading', { name: 'Rocket' })
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Gear' })).toHaveAttribute(
      'href',
      '/fitness/gear'
    )
  })

  it('renders the meta line and the default sports line', async () => {
    render(<GearDetailView gearId="gear-1" actorHandle="@test@llun.test" />)

    expect(
      await screen.findByText(
        'Canyon Endurace · Road bike · 8.1 kg · added Nov 27, 2018'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText('Default for Ride, Gravel ride')
    ).toBeInTheDocument()
  })

  it('omits the missing parts of the meta line', async () => {
    mockGetFitnessGearList.mockResolvedValue([
      createGear({
        brand: null,
        model: null,
        bikeType: null,
        weightKilograms: null,
        defaultSports: []
      })
    ])
    render(<GearDetailView gearId="gear-1" actorHandle="@test@llun.test" />)

    expect(await screen.findByText('added Nov 27, 2018')).toBeInTheDocument()
    expect(screen.getByText('No default sports')).toBeInTheDocument()
  })

  it('renders three stat tiles for a bike including the installed component count', async () => {
    mockGetFitnessGearComponents.mockResolvedValue([
      createComponent(),
      createComponent({ id: 'component-2' }),
      createComponent({ id: 'component-old', removedAt: Date.UTC(2025, 5, 1) })
    ])
    render(<GearDetailView gearId="gear-1" actorHandle="@test@llun.test" />)

    expect(await screen.findByText('35,253.7 km')).toBeInTheDocument()
    expect(screen.getByText('Activities')).toBeInTheDocument()
    expect(screen.getByText('1204')).toBeInTheDocument()
    // Scoped to the tile and matched whole: a bare getByText('2') matches any
    // exact "2" on the page, and `toHaveTextContent('2')` on the tile is a
    // substring match that a 12 or a 20 would satisfy just as well.
    const installedValue = screen.getByText(
      'Components installed'
    ).nextElementSibling
    // The replaced component does not count toward the tile.
    expect(installedValue).toHaveTextContent(/^2$/)
    // "Distance" is both a stat tile and the components table's column header.
    expect(screen.getAllByText('Distance')).toHaveLength(2)
  })

  it('renders two stat tiles and no components card for shoes', async () => {
    mockGetFitnessGearList.mockResolvedValue([
      createGear({
        kind: 'shoes',
        name: 'Cloudmonster',
        bikeType: null,
        weightKilograms: null,
        defaultSports: ['run'],
        alertDistanceMeters: 650000
      })
    ])
    render(<GearDetailView gearId="gear-1" actorHandle="@test@llun.test" />)

    expect(await screen.findByText('Distance')).toBeInTheDocument()
    expect(screen.getByText('Activities')).toBeInTheDocument()
    expect(screen.queryByText('Components installed')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Components' })
    ).not.toBeInTheDocument()
    expect(mockGetFitnessGearComponents).not.toHaveBeenCalled()
  })

  it('renders the retired badge and the frozen-total explanation', async () => {
    mockGetFitnessGearList.mockResolvedValue([
      createGear({ retiredAt: Date.UTC(2025, 2, 9, 12) })
    ])
    render(<GearDetailView gearId="gear-1" actorHandle="@test@llun.test" />)

    expect(await screen.findByText('retired')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Retired Mar 9, 2025 — total frozen, excluded from auto-assign and pickers.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unretire' })).toBeInTheDocument()
  })

  it('retires the gear and refetches', async () => {
    render(<GearDetailView gearId="gear-1" actorHandle="@test@llun.test" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Retire' }))

    await waitFor(() =>
      expect(mockSetFitnessGearRetired).toHaveBeenCalledWith('gear-1', true)
    )
    // The refetch is what keeps the derived distances honest.
    await waitFor(() => expect(mockGetFitnessGearList).toHaveBeenCalledTimes(2))
  })

  it('unretires a retired gear', async () => {
    mockGetFitnessGearList.mockResolvedValue([
      createGear({ retiredAt: Date.UTC(2025, 2, 9) })
    ])
    render(<GearDetailView gearId="gear-1" actorHandle="@test@llun.test" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Unretire' }))

    await waitFor(() =>
      expect(mockSetFitnessGearRetired).toHaveBeenCalledWith('gear-1', false)
    )
  })

  it('surfaces a retire failure', async () => {
    mockSetFitnessGearRetired.mockRejectedValue(new Error('Gear is locked'))
    render(<GearDetailView gearId="gear-1" actorHandle="@test@llun.test" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Retire' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Gear is locked')
    // A failed retire never refetches, so the page still shows the live gear.
    expect(mockGetFitnessGearList).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Retire' })).toBeEnabled()
  })

  it('disables the retire button while the change is in flight', async () => {
    let resolveRetire: (gear: GearEntity) => void = () => {}
    mockSetFitnessGearRetired.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRetire = resolve
        })
    )
    render(<GearDetailView gearId="gear-1" actorHandle="@test@llun.test" />)

    const retire = await screen.findByRole('button', { name: 'Retire' })
    fireEvent.click(retire)

    await waitFor(() => expect(retire).toBeDisabled())

    resolveRetire(createGear({ retiredAt: Date.UTC(2026, 0, 1) }))
    await waitFor(() => expect(mockGetFitnessGearList).toHaveBeenCalledTimes(2))
  })

  it('keeps the components card mounted while a refetch is in flight', async () => {
    mockGetFitnessGearComponents.mockResolvedValue([
      createComponent(),
      createComponent({
        id: 'component-old',
        componentType: 'Cassette',
        removedAt: Date.UTC(2025, 5, 1)
      })
    ])
    let resolveRefetch: (gears: GearEntity[]) => void = () => {}
    mockGetFitnessGearList
      .mockResolvedValueOnce([createGear()])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefetch = resolve
          })
      )
    render(<GearDetailView gearId="gear-1" actorHandle="@test@llun.test" />)

    // Expand the replaced rows: the child's own state is what a remount loses.
    fireEvent.click(
      await screen.findByRole('button', { name: 'Show 1 replaced component' })
    )
    expect(screen.getByText('Cassette')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retire' }))
    await waitFor(() => expect(mockGetFitnessGearList).toHaveBeenCalledTimes(2))

    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
    expect(screen.getByText('Chain')).toBeInTheDocument()
    expect(screen.getByText('Cassette')).toBeInTheDocument()

    resolveRefetch([createGear({ retiredAt: Date.UTC(2026, 0, 1) })])
    await screen.findByRole('button', { name: 'Unretire' })
  })

  it('opens the edit dialog seeded with the gear', async () => {
    render(<GearDetailView gearId="gear-1" actorHandle="@test@llun.test" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    expect(
      await screen.findByRole('heading', { name: 'Edit bike' })
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Brand')).toHaveValue('Canyon')
  })

  it('reports a gear id that is not in the list', async () => {
    mockGetFitnessGearList.mockResolvedValue([])
    render(<GearDetailView gearId="missing" actorHandle="@test@llun.test" />)

    expect(await screen.findByText('Gear not found.')).toBeInTheDocument()
  })

  it('surfaces a load failure', async () => {
    mockGetFitnessGearList.mockRejectedValue(new Error('Gear service down'))
    render(<GearDetailView gearId="gear-1" actorHandle="@test@llun.test" />)

    expect(await screen.findByText('Gear service down')).toBeInTheDocument()
  })

  it('renders a recording device through the device page, not the bike one', async () => {
    // The two pages share the route, the fetch and the edit dialog, and nothing
    // below them: a device has no distance, no components and no Retire.
    mockGetFitnessGearList.mockResolvedValue([
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
        firstUsedAt: Date.UTC(2023, 4, 2)
      })
    ])

    render(<GearDetailView gearId="device-1" actorHandle="@test@llun.test" />)

    expect(
      await screen.findByRole('heading', { name: 'Garmin Edge 840' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Retire' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Distance')).not.toBeInTheDocument()
    expect(mockGetFitnessGearComponents).not.toHaveBeenCalled()
  })
})
