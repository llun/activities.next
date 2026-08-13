/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

import { type GearActivityItem, getFitnessGearActivities } from '@/lib/client'
import type { GearEntity } from '@/lib/services/fitness-gears/gearEntities'

import { DeviceDetailView } from './DeviceDetailView'

vi.mock('@/lib/client', () => ({
  getFitnessGearActivities: vi.fn()
}))

// next/link swallows `prefetch` instead of reflecting it in the DOM.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    prefetch?: boolean | 'auto' | null
    children: ReactNode
  }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  )
}))

const mockGetFitnessGearActivities =
  getFitnessGearActivities as jest.MockedFunction<
    typeof getFitnessGearActivities
  >

const createDevice = (overrides: Partial<GearEntity> = {}): GearEntity => ({
  id: 'device-1',
  kind: 'device',
  name: 'Garmin Edge 840',
  brand: 'Garmin',
  model: 'Edge 840',
  bikeType: null,
  weightKilograms: null,
  defaultSports: [],
  alertDistanceMeters: null,
  notes: null,
  retiredAt: null,
  createdAt: Date.UTC(2023, 4, 2),
  distanceMeters: 0,
  activityCount: 412,
  productUrl: 'https://www.garmin.com',
  firstUsedAt: Date.UTC(2023, 4, 2),
  ...overrides
})

const createActivity = (
  overrides: Partial<GearActivityItem> = {}
): GearActivityItem => ({
  id: 'file-1',
  statusId: 'https://llun.test/users/test/statuses/1',
  statusPublicId: '0195f0a0-0000-7000-8000-000000000001',
  fileName: 'workout.fit',
  description: 'Morning ride',
  activityType: 'cycling',
  activityStartTime: Date.UTC(2026, 5, 1),
  totalDistanceMeters: 42_600,
  ...overrides
})

const renderView = (props: Partial<Parameters<typeof DeviceDetailView>[0]>) =>
  render(
    <DeviceDetailView
      gear={createDevice()}
      actorHandle="@test@llun.test"
      backLink={<a href="/fitness/gear">Gear</a>}
      onEdit={vi.fn()}
      {...props}
    />
  )

describe('DeviceDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetFitnessGearActivities.mockResolvedValue({
      activities: [],
      hasMore: false
    })
  })

  it('renders the name, the meta line and Edit alone', async () => {
    renderView({})

    expect(
      await screen.findByRole('heading', { name: 'Garmin Edge 840' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Garmin Edge 840 · recording since May 2, 2023')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    // A device cannot be retired, and deleting one would just be recreated by
    // the next upload from it.
    expect(
      screen.queryByRole('button', { name: 'Retire' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Delete' })
    ).not.toBeInTheDocument()
  })

  it('shows two stat tiles and no distance', async () => {
    renderView({})

    await screen.findByRole('heading', { name: 'Garmin Edge 840' })
    // Twice on purpose: the stat tile's label and the activity card's heading.
    expect(screen.getAllByText('Activities')).toHaveLength(2)
    expect(screen.getByText('412')).toBeInTheDocument()
    expect(screen.getByText('First used')).toBeInTheDocument()
    // Summing a head unit's rides and runs together would mean nothing.
    expect(screen.queryByText('Distance')).not.toBeInTheDocument()
  })

  it('renders an em dash for a device with no dated activity yet', async () => {
    renderView({ gear: createDevice({ firstUsedAt: null }) })

    await screen.findByRole('heading', { name: 'Garmin Edge 840' })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/recording since/)).not.toBeInTheDocument()
  })

  it('links the product page by hostname', async () => {
    renderView({})

    const link = await screen.findByRole('link', { name: /garmin\.com/ })
    expect(link).toHaveAttribute('href', 'https://www.garmin.com')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('offers to add a product page when there is none', async () => {
    const onEdit = vi.fn()
    renderView({ gear: createDevice({ productUrl: null }), onEdit })

    const button = await screen.findByRole('button', {
      name: 'No product page — add one'
    })
    fireEvent.click(button)
    expect(onEdit).toHaveBeenCalled()
  })

  it('renders each activity as a row linking to its status page', async () => {
    mockGetFitnessGearActivities.mockResolvedValue({
      activities: [createActivity()],
      hasMore: false
    })
    renderView({})

    const row = await screen.findByRole('link', { name: /Morning ride/ })
    expect(row).toHaveAttribute(
      'href',
      '/@test@llun.test/0195f0a0-0000-7000-8000-000000000001'
    )
    // One link per row of a list that grows without bound.
    expect(row).toHaveAttribute('data-prefetch', 'false')
    expect(row).toHaveTextContent('Jun 1, 2026')
    expect(row).toHaveTextContent('cycling')
    expect(row).toHaveTextContent('42.6 km')
  })

  it('falls back to the file name when the activity has no description', async () => {
    mockGetFitnessGearActivities.mockResolvedValue({
      activities: [createActivity({ description: null })],
      hasMore: false
    })
    renderView({})

    expect(await screen.findByText('workout.fit')).toBeInTheDocument()
  })

  it('leaves an activity that was never posted unlinked', async () => {
    mockGetFitnessGearActivities.mockResolvedValue({
      activities: [createActivity({ statusId: null, statusPublicId: null })],
      hasMore: false
    })
    renderView({})

    expect(await screen.findByText('Morning ride')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Morning ride/ })
    ).not.toBeInTheDocument()
  })

  it('still links a posted activity whose status predates the publicId backfill', async () => {
    // `statuses.publicId` is nullable and stays null on any instance that has
    // not run the backfill (docs/maintenance.md → Public ID Backfill), so
    // `statusPublicId` alone is NOT the test for "was this posted?". Treating
    // those as unposted would silently unlink an athlete's whole history.
    mockGetFitnessGearActivities.mockResolvedValue({
      activities: [
        createActivity({
          statusId: 'https://llun.test/users/test/statuses/1',
          statusPublicId: null
        })
      ],
      hasMore: false
    })
    renderView({})

    const row = await screen.findByRole('link', { name: /Morning ride/ })
    expect(row).toHaveAttribute(
      'href',
      `/@test@llun.test/${encodeURIComponent('https://llun.test/users/test/statuses/1')}`
    )
  })

  it('renders an em dash for a missing date, type and distance', async () => {
    mockGetFitnessGearActivities.mockResolvedValue({
      activities: [
        createActivity({
          activityStartTime: null,
          activityType: null,
          totalDistanceMeters: null
        })
      ],
      hasMore: false
    })
    renderView({})

    const row = await screen.findByRole('link', { name: /Morning ride/ })
    expect(row.textContent?.match(/—/g)).toHaveLength(3)
  })

  it('loads the next page from the current offset', async () => {
    mockGetFitnessGearActivities.mockResolvedValueOnce({
      activities: [createActivity({ id: 'file-1' })],
      hasMore: true
    })
    renderView({})

    const loadMore = await screen.findByRole('button', { name: 'Load more' })
    mockGetFitnessGearActivities.mockResolvedValueOnce({
      activities: [
        createActivity({ id: 'file-2', description: 'Evening ride' })
      ],
      hasMore: false
    })
    fireEvent.click(loadMore)

    await waitFor(() =>
      expect(screen.getByText('Evening ride')).toBeInTheDocument()
    )
    expect(mockGetFitnessGearActivities).toHaveBeenLastCalledWith('device-1', {
      limit: 20,
      offset: 1
    })
    expect(screen.getByText('Morning ride')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Load more' })
    ).not.toBeInTheDocument()
  })

  it('pages from the rows the server handed over, not the deduped list length', async () => {
    // Offset pagination over a growing list repeats the boundary row, which the
    // append dedupes away. Paging from `activities.length` after that would
    // re-request rows already consumed — and a page that is entirely duplicates
    // would leave "Load more" stuck at the same offset forever.
    mockGetFitnessGearActivities.mockResolvedValueOnce({
      activities: [createActivity({ id: 'file-1' })],
      hasMore: true
    })
    renderView({})

    const loadMore = await screen.findByRole('button', { name: 'Load more' })
    mockGetFitnessGearActivities.mockResolvedValueOnce({
      // The whole page is the boundary row again, so nothing is appended.
      activities: [createActivity({ id: 'file-1' })],
      hasMore: true
    })
    fireEvent.click(loadMore)

    await waitFor(() =>
      expect(mockGetFitnessGearActivities).toHaveBeenCalledTimes(2)
    )
    expect(screen.getAllByText('Morning ride')).toHaveLength(1)

    mockGetFitnessGearActivities.mockResolvedValueOnce({
      activities: [
        createActivity({ id: 'file-2', description: 'Evening ride' })
      ],
      hasMore: false
    })
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() =>
      expect(screen.getByText('Evening ride')).toBeInTheDocument()
    )
    // 2, not 1: the offset advanced past the duplicate the server sent.
    expect(mockGetFitnessGearActivities).toHaveBeenLastCalledWith('device-1', {
      limit: 20,
      offset: 2
    })
  })

  describe('switching to another device on the same mounted instance', () => {
    // `GearDetailView` renders this component at a fixed position with no
    // `key`, so navigating between two device pages swaps `gear` on the SAME
    // instance rather than remounting. Nothing tested that before, which is how
    // both bugs below shipped.
    const renderThenSwitch = async () => {
      let resolveStale: (value: {
        activities: GearActivityItem[]
        hasMore: boolean
      }) => void = () => {}
      const stalePage = new Promise<{
        activities: GearActivityItem[]
        hasMore: boolean
      }>((resolve) => {
        resolveStale = resolve
      })

      mockGetFitnessGearActivities.mockResolvedValueOnce({
        activities: [createActivity({ id: 'a-1', description: 'Device A' })],
        hasMore: true
      })
      const view = render(
        <DeviceDetailView
          gear={createDevice()}
          actorHandle="@test@llun.test"
          backLink={<a href="/fitness/gear">Gear</a>}
          onEdit={vi.fn()}
        />
      )
      const loadMore = await screen.findByRole('button', { name: 'Load more' })

      // "Load more" on device A, still in flight when the gear changes.
      mockGetFitnessGearActivities.mockReturnValueOnce(stalePage)
      fireEvent.click(loadMore)

      mockGetFitnessGearActivities.mockResolvedValueOnce({
        activities: [createActivity({ id: 'b-1', description: 'Device B' })],
        hasMore: true
      })
      view.rerender(
        <DeviceDetailView
          gear={createDevice({ id: 'device-2', name: 'Wahoo ELEMNT BOLT' })}
          actorHandle="@test@llun.test"
          backLink={<a href="/fitness/gear">Gear</a>}
          onEdit={vi.fn()}
        />
      )
      await waitFor(() =>
        expect(screen.getByText('Device B')).toBeInTheDocument()
      )

      resolveStale({
        activities: [createActivity({ id: 'a-2', description: 'Stale ride' })],
        hasMore: true
      })
      await waitFor(() => expect(stalePage).resolves.toBeDefined())
      return view
    }

    it('never leaves the new device stuck loading', async () => {
      await renderThenSwitch()

      // The superseded request's `finally` is skipped, so the effect has to
      // clear this itself or the button is disabled forever.
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled()
      )
    })

    it('drops the previous device’s page instead of appending it', async () => {
      await renderThenSwitch()

      expect(screen.getByText('Device B')).toBeInTheDocument()
      expect(screen.queryByText('Stale ride')).not.toBeInTheDocument()
      expect(screen.queryByText('Device A')).not.toBeInTheDocument()
    })
  })

  it('reports an empty history', async () => {
    renderView({})

    expect(
      await screen.findByText('Nothing recorded on this device yet.')
    ).toBeInTheDocument()
  })

  it('surfaces a failure to load the activity list', async () => {
    mockGetFitnessGearActivities.mockRejectedValue(
      new Error('Activity service down')
    )
    renderView({})

    expect(await screen.findByText('Activity service down')).toBeInTheDocument()
  })
})
