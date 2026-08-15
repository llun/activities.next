/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import type { GearEntity } from '@/lib/services/fitness-gears/gearEntities'
import { ActorProfile } from '@/lib/types/domain/actor'

import { DeviceDetailView } from './DeviceDetailView'
import type { GearActivityFeedContext } from './GearActivitiesFeed'

// The feed is covered by its own test; here it stands in as a marker so this
// file stays about the device's chrome and what it hands the feed.
vi.mock('./GearActivitiesFeed', () => ({
  GearActivitiesFeed: (props: {
    gearId: string
    emptyMessage: string
    currentActor: ActorProfile
  }) => (
    <div
      data-testid="activities-feed"
      data-gear-id={props.gearId}
      data-current-actor={props.currentActor.id}
    >
      {props.emptyMessage}
    </div>
  )
}))

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

const renderView = (props: Partial<Parameters<typeof DeviceDetailView>[0]>) =>
  render(
    <DeviceDetailView
      gear={createDevice()}
      backLink={<a href="/fitness/gear">Gear</a>}
      onEdit={vi.fn()}
      feed={feed}
      {...props}
    />
  )

describe('DeviceDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the name, the meta line and Edit alone', () => {
    renderView({})

    expect(
      screen.getByRole('heading', { name: 'Garmin Edge 840' })
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

  it('shows two stat tiles and no distance', () => {
    renderView({})

    expect(screen.getByText('Activities')).toBeInTheDocument()
    expect(screen.getByText('412')).toBeInTheDocument()
    expect(screen.getByText('First used')).toBeInTheDocument()
    // Summing a head unit's rides and runs together would mean nothing.
    expect(screen.queryByText('Distance')).not.toBeInTheDocument()
  })

  it('renders an em dash for a device with no dated activity yet', () => {
    renderView({ gear: createDevice({ firstUsedAt: null }) })

    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/recording since/)).not.toBeInTheDocument()
  })

  it('links the product page by hostname', () => {
    renderView({})

    const link = screen.getByRole('link', { name: /garmin\.com/ })
    expect(link).toHaveAttribute('href', 'https://www.garmin.com')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('offers to add a product page when there is none', () => {
    const onEdit = vi.fn()
    renderView({ gear: createDevice({ productUrl: null }), onEdit })

    fireEvent.click(
      screen.getByRole('button', { name: 'No product page — add one' })
    )
    expect(onEdit).toHaveBeenCalled()
  })

  it('renders the shared activities feed for this device, with no view switcher', () => {
    // A device has no components, so there is nothing to switch between: the
    // page is its facts and then its activities, as the design's device
    // surface has it.
    renderView({})

    const activitiesFeed = screen.getByTestId('activities-feed')
    expect(activitiesFeed).toHaveAttribute('data-gear-id', 'device-1')
    expect(activitiesFeed).toHaveAttribute('data-current-actor', profile.id)
    expect(activitiesFeed).toHaveTextContent(
      'No recent activities recorded with this device.'
    )
    expect(
      screen.queryByRole('navigation', { name: 'Gear sections' })
    ).not.toBeInTheDocument()
  })
})
