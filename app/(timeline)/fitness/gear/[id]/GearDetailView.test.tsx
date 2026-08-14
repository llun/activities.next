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
  getFitnessGearComponents,
  getFitnessGearList,
  setFitnessGearRetired
} from '@/lib/client'
import type {
  GearComponentEntity,
  GearEntity
} from '@/lib/services/fitness-gears/gearEntities'
import { ActorProfile } from '@/lib/types/domain/actor'

import type { GearActivityFeedContext } from './GearActivitiesFeed'
import { GearDetailView } from './GearDetailView'

// The feed has its own test; here it stands in as a marker so this file stays
// about the page's chrome and which view it shows.
vi.mock('./GearActivitiesFeed', () => ({
  GearActivitiesFeed: (props: { gearId: string; emptyMessage: string }) => (
    <div data-testid="activities-feed" data-gear-id={props.gearId}>
      {props.emptyMessage}
    </div>
  )
}))

vi.mock('@/lib/client', () => ({
  createFitnessGear: vi.fn(),
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

const FIXED_CURRENT_TIME = new Date('2026-06-01T10:00:00.000Z').getTime()

const profile: ActorProfile = {
  id: 'https://llun.test/users/test',
  username: 'test',
  domain: 'llun.test',
  name: 'Test',
  followersUrl: 'https://llun.test/users/test/followers',
  inboxUrl: 'https://llun.test/users/test/inbox',
  sharedInboxUrl: 'https://llun.test/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: FIXED_CURRENT_TIME
}

const feed: GearActivityFeedContext = {
  host: 'llun.test',
  currentTime: FIXED_CURRENT_TIME,
  currentActor: profile,
  isMediaUploadEnabled: true
}

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
    render(<GearDetailView gearId="gear-1" feed={feed} />)

    expect(
      await screen.findByRole('heading', { name: 'Rocket' })
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Gear' })).toHaveAttribute(
      'href',
      '/fitness/gear'
    )
  })

  it('renders the meta line and the default sports line', async () => {
    render(<GearDetailView gearId="gear-1" feed={feed} />)

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
    render(<GearDetailView gearId="gear-1" feed={feed} />)

    expect(await screen.findByText('added Nov 27, 2018')).toBeInTheDocument()
    expect(screen.getByText('No default sports')).toBeInTheDocument()
  })

  it('renders three stat tiles for a bike including the installed component count', async () => {
    mockGetFitnessGearComponents.mockResolvedValue([
      createComponent(),
      createComponent({ id: 'component-2' }),
      createComponent({ id: 'component-old', removedAt: Date.UTC(2025, 5, 1) })
    ])
    render(<GearDetailView gearId="gear-1" feed={feed} />)

    expect(await screen.findByText('35,253.7 km')).toBeInTheDocument()
    expect(screen.getByText('Activities')).toBeInTheDocument()
    expect(screen.getByText('1204')).toBeInTheDocument()
    expect(screen.getByText('Components installed')).toBeInTheDocument()
    // The replaced component counts toward neither the tile nor the header.
    expect(screen.getByText('2 installed')).toBeInTheDocument()
    // "Distance" is both a stat tile and the components table's column header.
    expect(screen.getAllByText('Distance')).toHaveLength(2)
  })

  it('renders two stat tiles and the activities feed for shoes', async () => {
    // Shoes carry no components card, so there is no second view to reach and
    // no switcher to render — the page goes straight to the activities.
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
    render(<GearDetailView gearId="gear-1" feed={feed} />)

    expect(await screen.findByText('Distance')).toBeInTheDocument()
    expect(screen.getByText('Activities')).toBeInTheDocument()
    expect(screen.queryByText('Components installed')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Components' })
    ).not.toBeInTheDocument()
    expect(mockGetFitnessGearComponents).not.toHaveBeenCalled()
    expect(screen.getByTestId('activities-feed')).toHaveAttribute(
      'data-gear-id',
      'gear-1'
    )
    expect(
      screen.queryByRole('navigation', { name: 'Gear sections' })
    ).not.toBeInTheDocument()
  })

  describe('the Components / Activities switcher', () => {
    // Radix opens on keydown, not on a jsdom `click`.
    const chooseView = async (name: string) => {
      const nav = await screen.findByRole('navigation', {
        name: 'Gear sections'
      })
      fireEvent.keyDown(within(nav).getByRole('button'), { key: 'ArrowDown' })
      const menu = await screen.findByRole('menu')
      fireEvent.click(within(menu).getByRole('menuitem', { name }))
    }

    it('opens a bike on its components, with the switcher beside them', async () => {
      mockGetFitnessGearComponents.mockResolvedValue([createComponent()])
      render(<GearDetailView gearId="gear-1" feed={feed} />)

      expect(
        await screen.findByRole('heading', { name: 'Components' })
      ).toBeInTheDocument()
      expect(screen.queryByTestId('activities-feed')).not.toBeInTheDocument()
      expect(
        screen.getByRole('navigation', { name: 'Gear sections' })
      ).toBeInTheDocument()
      // The trigger names the view it is on.
      expect(
        screen.getByRole('button', { name: /Components/ })
      ).toBeInTheDocument()
    })

    it('swaps the components card for the activities feed', async () => {
      mockGetFitnessGearComponents.mockResolvedValue([createComponent()])
      render(<GearDetailView gearId="gear-1" feed={feed} />)

      // Radix opens on keydown, not on a jsdom `click`.
      const nav = await screen.findByRole('navigation', {
        name: 'Gear sections'
      })
      fireEvent.keyDown(within(nav).getByRole('button'), { key: 'ArrowDown' })
      const menu = await screen.findByRole('menu')
      fireEvent.click(
        within(menu).getByRole('menuitem', { name: 'Activities' })
      )

      const activitiesFeed = await screen.findByTestId('activities-feed')
      expect(activitiesFeed).toHaveAttribute('data-gear-id', 'gear-1')
      expect(activitiesFeed).toHaveTextContent(
        'No recent activities on this gear.'
      )
      expect(
        screen.queryByRole('heading', { name: 'Components' })
      ).not.toBeInTheDocument()
    })

    it('does not mount the feed until Activities is first opened', async () => {
      // Mounting it eagerly would fetch a page of posts for every reader who
      // only ever looks at the components.
      mockGetFitnessGearComponents.mockResolvedValue([createComponent()])
      render(<GearDetailView gearId="gear-1" feed={feed} />)

      await screen.findByRole('heading', { name: 'Components' })
      expect(screen.queryByTestId('activities-feed')).not.toBeInTheDocument()
    })

    it('keeps the components card mounted while the reader is on Activities', async () => {
      // The card holds its add form, its typed-in values and its "Show N
      // replaced" toggle in local state, and a glance at Activities mid-form
      // would otherwise throw all of it away — the same loss a refetch is
      // already careful not to cause.
      mockGetFitnessGearComponents.mockResolvedValue([
        createComponent(),
        createComponent({
          id: 'component-old',
          componentType: 'Cassette',
          removedAt: Date.UTC(2025, 5, 1)
        })
      ])
      render(<GearDetailView gearId="gear-1" feed={feed} />)

      fireEvent.click(
        await screen.findByRole('button', { name: 'Show 1 replaced component' })
      )
      expect(screen.getByText('Cassette')).toBeInTheDocument()

      await chooseView('Activities')
      await chooseView('Components')

      // Still expanded: the card was hidden, not torn down and rebuilt.
      expect(screen.getByText('Cassette')).toBeInTheDocument()
    })

    it('keeps the feed mounted when the reader switches back to Components', async () => {
      // Unmounting would drop every page the reader had scrolled through and
      // re-request page one on the way back, at a batched status read per page.
      mockGetFitnessGearComponents.mockResolvedValue([createComponent()])
      render(<GearDetailView gearId="gear-1" feed={feed} />)

      await chooseView('Activities')
      expect(await screen.findByTestId('activities-feed')).toBeVisible()

      await chooseView('Components')

      expect(
        await screen.findByRole('heading', { name: 'Components' })
      ).toBeInTheDocument()
      const activitiesFeed = screen.getByTestId('activities-feed')
      expect(activitiesFeed).toBeInTheDocument()
      expect(activitiesFeed).not.toBeVisible()
    })
  })

  it('renders the retired badge and the frozen-total explanation', async () => {
    mockGetFitnessGearList.mockResolvedValue([
      createGear({ retiredAt: Date.UTC(2025, 2, 9, 12) })
    ])
    render(<GearDetailView gearId="gear-1" feed={feed} />)

    expect(await screen.findByText('retired')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Retired Mar 9, 2025 — total frozen, excluded from auto-assign and pickers.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unretire' })).toBeInTheDocument()
  })

  it('retires the gear and refetches', async () => {
    render(<GearDetailView gearId="gear-1" feed={feed} />)

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
    render(<GearDetailView gearId="gear-1" feed={feed} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Unretire' }))

    await waitFor(() =>
      expect(mockSetFitnessGearRetired).toHaveBeenCalledWith('gear-1', false)
    )
  })

  it('surfaces a retire failure', async () => {
    mockSetFitnessGearRetired.mockRejectedValue(new Error('Gear is locked'))
    render(<GearDetailView gearId="gear-1" feed={feed} />)

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
    render(<GearDetailView gearId="gear-1" feed={feed} />)

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
    render(<GearDetailView gearId="gear-1" feed={feed} />)

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
    render(<GearDetailView gearId="gear-1" feed={feed} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    expect(
      await screen.findByRole('heading', { name: 'Edit bike' })
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Brand')).toHaveValue('Canyon')
  })

  it('reports a gear id that is not in the list', async () => {
    mockGetFitnessGearList.mockResolvedValue([])
    render(<GearDetailView gearId="missing" feed={feed} />)

    expect(await screen.findByText('Gear not found.')).toBeInTheDocument()
  })

  it('surfaces a load failure', async () => {
    mockGetFitnessGearList.mockRejectedValue(new Error('Gear service down'))
    render(<GearDetailView gearId="gear-1" feed={feed} />)

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

    render(<GearDetailView gearId="device-1" feed={feed} />)

    expect(
      await screen.findByRole('heading', { name: 'Garmin Edge 840' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Retire' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Distance')).not.toBeInTheDocument()
    expect(mockGetFitnessGearComponents).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('navigation', { name: 'Gear sections' })
    ).not.toBeInTheDocument()
  })
})
