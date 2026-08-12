/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
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

  it('announces a failed save from every control that can cause it', async () => {
    const bike = createGear({ defaultSports: ['ride'] })
    mockGetFitnessGearList.mockResolvedValue([bike])
    mockUpdateFitnessGear.mockRejectedValue(new Error('Failed to save gear.'))

    render(<StravaGearDefaultsSection />)

    // Driven from Remove, so the assertion below has to cover Remove — an
    // earlier version of this test failed from Remove and then asserted on the
    // picker, which passed without covering the causing control at all.
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Ride' }))

    // A closed menu, an unchanged trigger and text appended at the bottom of
    // the section is otherwise silent: nothing tells a screen reader the write
    // failed rather than did nothing.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Failed to save gear.')
    expect(screen.getByRole('button', { name: 'Remove Ride' })).toHaveAttribute(
      'aria-describedby',
      alert.id
    )
    expect(
      screen.getByRole('button', { name: gearTriggerFor('Ride') })
    ).toHaveAttribute('aria-describedby', alert.id)
  })

  it('returns focus to the row after a failed remove', async () => {
    // The row is still there on failure, and the button that was clicked is
    // disabled mid-write — which blurs it — so without a restore the reader is
    // on `<body>` with an alert they have to Tab from the top to reach.
    const bike = createGear({ defaultSports: ['ride'] })
    mockGetFitnessGearList.mockResolvedValue([bike])
    let rejectSave: (error: Error) => void = () => {}
    mockUpdateFitnessGear.mockReturnValue(
      new Promise<GearEntity>((_resolve, reject) => {
        rejectSave = reject
      })
    )

    render(<StravaGearDefaultsSection />)

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Ride' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove Ride' })).toBeDisabled()
    )

    await act(async () => {
      rejectSave(new Error('Failed to save gear.'))
    })

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: gearTriggerFor('Ride') })
      ).toHaveFocus()
    )
  })

  it('leaves focus alone when the reader moved it during the write', async () => {
    // The section disables itself during a write but the Strava credential
    // form above it does not, so yanking focus back would pull a reader out of
    // a field they had started typing in.
    const moots = createGear({ defaultSports: ['ride'] })
    const giant = createGear({
      id: 'gear-other',
      name: 'Giant',
      defaultSports: []
    })
    mockGetFitnessGearList.mockResolvedValue([moots, giant])
    let resolveSave: (gear: GearEntity) => void = () => {}
    mockUpdateFitnessGear.mockReturnValue(
      new Promise<GearEntity>((resolve) => {
        resolveSave = resolve
      })
    )

    const elsewhere = document.createElement('button')
    elsewhere.textContent = 'Somewhere else'
    document.body.appendChild(elsewhere)

    render(<StravaGearDefaultsSection />)

    const menu = await openMenu(gearTriggerFor('Ride'))
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Giant/ }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: gearTriggerFor('Ride') })
      ).toBeDisabled()
    )

    elsewhere.focus()
    await act(async () => {
      resolveSave(giant)
    })

    expect(elsewhere).toHaveFocus()
    elsewhere.remove()
  })

  it('does not claim the shed is empty when the gear list fails to load', async () => {
    // The empty states key on `gears.length`, so collapsing a failed load to
    // an empty array would tell an actor with a full shed to go add gear.
    mockGetFitnessGearList.mockRejectedValue(new Error('nope'))

    render(<StravaGearDefaultsSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to load gear.'
    )
    expect(
      screen.queryByRole('link', { name: 'Add a bike or a pair of shoes' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Loading gear…')).not.toBeInTheDocument()
  })

  it('can retry a failed load rather than dead-ending until a page reload', async () => {
    // A failed load renders no rows and no add control, so the only thing that
    // clears the error — a successful write — is otherwise unreachable.
    mockGetFitnessGearList
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValueOnce([createGear({ defaultSports: ['ride'] })])

    render(<StravaGearDefaultsSection />)

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(
      await screen.findByRole('button', { name: gearTriggerFor('Ride') })
    ).toHaveTextContent('Moots')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('gives the add menu groups an accessible name', async () => {
    // Radix's MenuGroup is a bare `role="group"` and its Label a bare div, so
    // without the explicit association the heading text is skipped entirely —
    // a regression from the `<optgroup label>` this replaced.
    mockGetFitnessGearList.mockResolvedValue([
      createGear({ defaultSports: [] }),
      createGear({ id: 'gear-shoes', kind: 'shoes', defaultSports: [] })
    ])

    render(<StravaGearDefaultsSection />)

    const menu = await openMenu(/Add activity type/)
    expect(
      within(menu).getByRole('group', { name: 'Cycling' })
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('group', { name: 'Running & walking' })
    ).toBeInTheDocument()
  })

  it('returns focus to the picker it was started from', async () => {
    // `onSelect` runs inside Radix's flushSync, so `setIsSaving(true)` lands
    // before the menu closes and Radix restores focus onto a disabled button —
    // dropping it to `<body>`, so the next Tab would restart from the top of
    // the document after every single change.
    //
    // The write is held open deliberately. With an instantly-resolving mock
    // the trigger is re-enabled before Radix's `onCloseAutoFocus` runs, so
    // Radix restores focus by itself and the test passes whether or not this
    // component does anything — verified by disabling the restore and watching
    // it still pass.
    const moots = createGear({ defaultSports: ['ride'] })
    const giant = createGear({
      id: 'gear-other',
      name: 'Giant',
      defaultSports: []
    })
    mockGetFitnessGearList.mockResolvedValue([moots, giant])
    let resolveSave: (gear: GearEntity) => void = () => {}
    mockUpdateFitnessGear.mockReturnValue(
      new Promise<GearEntity>((resolve) => {
        resolveSave = resolve
      })
    )

    render(<StravaGearDefaultsSection />)

    const menu = await openMenu(gearTriggerFor('Ride'))
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Giant/ }))

    // Mid-write: the trigger is disabled, so focus cannot be on it.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: gearTriggerFor('Ride') })
      ).toBeDisabled()
    )
    expect(
      screen.getByRole('button', { name: gearTriggerFor('Ride') })
    ).not.toHaveFocus()

    await act(async () => {
      resolveSave(giant)
    })

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: gearTriggerFor('Ride') })
      ).toHaveFocus()
    )
  })
})
