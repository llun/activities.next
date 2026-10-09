import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { expect, vi } from 'vitest'

import {
  type FitnessRouteDataResponse,
  type StatusFitnessFileItem,
  getFitnessFilesByStatus,
  getFitnessGearList,
  getFitnessRouteData,
  updateFitnessFileGear
} from '@/lib/client'
import type { GearEntity } from '@/lib/services/fitness-gears/gearEntities'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote } from '@/lib/types/domain/status'
import { loadMaplibreModule } from '@/lib/utils/maplibre'

import { FitnessStatusDetail } from './FitnessStatusDetail'
import { mockPush, mockRefresh } from './FitnessStatusDetail.mocks'

export const mockGetFitnessFilesByStatus = vi.mocked(getFitnessFilesByStatus)
export const mockGetFitnessRouteData = vi.mocked(getFitnessRouteData)
export const mockGetFitnessGearList = vi.mocked(getFitnessGearList)
export const mockUpdateFitnessFileGear = vi.mocked(updateFitnessFileGear)

export const buildGear = (overrides: Partial<GearEntity> = {}): GearEntity => ({
  id: 'gear-bike',
  kind: 'bike',
  name: 'Moots',
  brand: null,
  model: null,
  bikeType: null,
  weightKilograms: null,
  defaultSports: [],
  alertDistanceMeters: null,
  notes: null,
  retiredAt: null,
  createdAt: Date.parse('2026-01-01T00:00:00Z'),
  distanceMeters: 0,
  activityCount: 0,
  productUrl: null,
  firstUsedAt: null,
  ...overrides
})

export const actor = {
  id: 'https://activities.local/users/athlete',
  username: 'athlete',
  domain: 'activities.local',
  name: 'Athlete Runner'
} as unknown as ActorProfile

// A signed-in reader who is not the athlete.
export const notMe = {
  id: 'https://activities.local/users/spectator',
  username: 'spectator',
  domain: 'activities.local',
  name: 'Spectator'
} as unknown as ActorProfile

export const buildStatus = (overrides: Partial<StatusNote> = {}): StatusNote =>
  ({
    id: 'https://activities.local/users/athlete/statuses/ride-1',
    actorId: actor.id,
    actor,
    type: 'Note',
    url: 'https://activities.local/@athlete/ride-1',
    text: 'Sunset loop',
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [],
    edits: [],
    isLocalActor: true,
    reply: '',
    replies: [],
    actorAnnounceStatusId: null,
    isActorLiked: false,
    isActorBookmarked: false,
    totalLikes: 4,
    totalShares: 2,
    attachments: [],
    tags: [],
    createdAt: Date.parse('2026-05-27T10:42:00Z'),
    updatedAt: Date.parse('2026-05-27T10:42:00Z'),
    fitness: {
      id: 'fit-1',
      fileName: 'ride.fit',
      fileType: 'fit',
      mimeType: 'application/octet-stream',
      bytes: 2048,
      url: 'https://activities.local/fit/ride.fit',
      processingStatus: 'completed',
      totalDistanceMeters: 5000,
      totalDurationSeconds: 1800,
      elevationGainMeters: 120,
      activityType: 'ride',
      hasMapData: false
    },
    ...overrides
  }) as unknown as StatusNote

export const buildReactedStatus = (): StatusNote =>
  buildStatus({
    reactions: [
      { name: '\u{1F525}', count: 3, me: false, url: null, static_url: null }
    ]
  } as Partial<StatusNote>)

export const routeData: FitnessRouteDataResponse = {
  samples: [
    { lat: 13.7, lng: 100.5, elapsedSeconds: 0 },
    { lat: 13.71, lng: 100.51, elapsedSeconds: 900 },
    { lat: 13.72, lng: 100.52, elapsedSeconds: 1800 }
  ],
  totalDurationSeconds: 1800,
  powerSeries: [120, 150, 180, 210, 90, 60],
  heartRateSeries: [110, 130, 150, 165, 175, 140],
  altitudeSeries: [10, 24, 40, 55, 48, 30],
  speedSeries: [18, 22, 25, 28, 20, 16]
}

// A route split into a visible leg and a privacy-hidden leg, so the map panel
// draws a green stretch for the hint to explain.
export const routeDataWithHiddenSegments: FitnessRouteDataResponse = {
  ...routeData,
  segments: [
    { isHiddenByPrivacy: false, samples: routeData.samples.slice(0, 2) },
    { isHiddenByPrivacy: true, samples: routeData.samples.slice(1) }
  ]
}

export const buildFitnessFile = (
  overrides: Partial<StatusFitnessFileItem> = {}
): StatusFitnessFileItem => ({
  id: 'fit-1',
  actorId: actor.id,
  fileName: 'ride.fit',
  fileType: 'fit',
  statusId: 'https://activities.local/users/athlete/statuses/ride-1',
  isPrimary: true,
  processingStatus: 'completed',
  totalDistanceMeters: 5000,
  totalDurationSeconds: 1800,
  elevationGainMeters: 120,
  activityType: 'ride',
  activityStartTime: Date.parse('2026-05-27T10:42:00Z'),
  hasMapData: false,
  description: null,
  deviceManufacturer: null,
  deviceName: null,
  sourceUrl: null,
  gearId: null,
  gearName: null,
  movingTimeSeconds: null,
  deviceGearId: null,
  deviceGearName: null,
  ...overrides
})

export const renderDetail = (
  props: Partial<Parameters<typeof FitnessStatusDetail>[0]> = {}
) =>
  render(
    <FitnessStatusDetail
      host="activities.local"
      mapProvider={{ type: 'osm' }}
      currentTime={Date.parse('2026-05-27T12:00:00Z')}
      currentActor={actor}
      status={buildStatus()}
      onShowAttachment={vi.fn()}
      {...props}
    />
  )

export const openSectionMenu = async () => {
  fireEvent.keyDown(screen.getByRole('button', { name: /Overview/ }), {
    key: 'ArrowDown'
  })
  return screen.findByRole('menu')
}

// The metadata line's gear is a LINK to its gear page for the owner, named from
// its content so the accessible name carries the assignment too ("Gear: Moots");
// match on the prefix rather than pinning the current value.
export const getGearLink = () =>
  screen.findByRole('link', { name: /^Gear:/ }) as Promise<HTMLAnchorElement>

// Changing the assignment lives in the post's ⋯ menu, not on the metadata line.
export const getGearMenu = () =>
  screen.findByTestId('post-menu-submenu-change-gear')

// Pick-one-of-N, so the rows are `menuitemradio` rather than the `menuitem` the
// navigation dropdowns use.
export const getGearItem = (menu: HTMLElement, name: string | RegExp) =>
  within(menu).getByRole('menuitemradio', { name })

export const chooseGear = async (name: string | RegExp) => {
  const menu = await getGearMenu()
  fireEvent.click(getGearItem(menu, name))
}

// `findBy*` nested inside `waitFor` burns its own timeout on a genuine failure
// and reports a confusing error, so poll with the sync query instead.
export const expectGearLinkText = (text: string) =>
  waitFor(() =>
    expect(screen.getByRole('link', { name: /^Gear:/ })).toHaveTextContent(text)
  )

// Nothing is attributed, so the metadata line shows no gear at all — the only
// place "No gear" appears is as the submenu's clearing row.
export const expectNoGearOnMetaLine = () =>
  waitFor(() =>
    expect(
      screen.queryByRole('link', { name: /^Gear:/ })
    ).not.toBeInTheDocument()
  )

// Shared by every FitnessStatusDetail test file's beforeEach.
export const resetFitnessStatusDetailMocks = () => {
  mockPush.mockReset()
  mockRefresh.mockReset()
  mockGetFitnessFilesByStatus.mockReset()
  mockGetFitnessRouteData.mockReset()
  mockGetFitnessGearList.mockReset()
  mockUpdateFitnessFileGear.mockReset()
  mockGetFitnessFilesByStatus.mockResolvedValue(null)
  mockGetFitnessRouteData.mockResolvedValue(routeData)
  mockGetFitnessGearList.mockResolvedValue([])
  // Default: the GL loader never settles, so the map stays initializing.
  vi.mocked(loadMaplibreModule).mockImplementation(() => new Promise(() => {}))
}
