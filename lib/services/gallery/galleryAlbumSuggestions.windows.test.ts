import type { GalleryIndexRow } from '@/lib/database/sql/galleryMedia'
import { buildIndexRow } from '@/lib/services/gallery/__fixtures__/galleryIndexRow'
import {
  MAX_SUGGESTIONS_PER_KIND,
  MAX_SUGGESTION_MEDIA_IDS
} from '@/lib/services/gallery/galleryAlbumSuggestionEntities'
import { getGalleryAlbumSuggestions } from '@/lib/services/gallery/galleryAlbumSuggestions'
import { GALLERY_INDEX_CAP } from '@/lib/services/gallery/galleryQueries'

// The reads of `getGalleryAlbumSuggestions` that need more data than a real
// database is worth seeding with: the activity windows, the index windows and
// a cluster past what an album holds. The database is a fake that answers the
// way the real methods do.

const DAY = 24 * 60 * 60 * 1000

type Window = { startDate: number; endDate: number; offset: number }

const buildDatabase = ({
  owner,
  publicIndex = owner,
  activities = []
}: {
  owner: (maxId?: string) => GalleryIndexRow[]
  publicIndex?: (maxId?: string) => GalleryIndexRow[]
  activities?: number[]
}) => {
  const windows: Window[] = []
  const indexCalls: Array<{ audience: string; maxId?: string }> = []
  const sorted = [...activities].sort((a, b) => a - b)
  return {
    windows,
    indexCalls,
    database: {
      getGallerySettings: vi.fn(async () => ({
        hiddenLocations: [],
        hideThreatenedPlaces: true
      })) as never,
      getGalleryGearNamesByIds: vi.fn(async () => ({})),
      getGalleryMediaIndex: vi.fn(
        async ({
          audience,
          maxId
        }: {
          audience: { kind: string }
          maxId?: string
        }) => {
          indexCalls.push({ audience: audience.kind, maxId })
          return audience.kind === 'owner' ? owner(maxId) : publicIndex(maxId)
        }
      ),
      // No photo can be read back: every preview falls back to null.
      getGalleryMediaByIds: vi.fn(async () => []),
      getGalleryAlbumItemSets: vi.fn(async () => []),
      getFitnessActivitiesInWindow: vi.fn(
        async ({
          startDate,
          endDate,
          limit,
          offset
        }: {
          startDate: number
          endDate: number
          limit: number
          offset: number
        }) => {
          windows.push({ startDate, endDate, offset })
          const inside = sorted.filter((t) => t >= startDate && t < endDate)
          return {
            activities: inside
              .slice(offset, offset + limit)
              .map((startTime) => ({ startTime })),
            hasMore: offset + limit < inside.length
          }
        }
      )
    } as never
  }
}

// `count` photos on one UTC day, an hour apart from 08:00.
const photosOnDay = (firstId: number, day: number, count: number) =>
  Array.from({ length: count }, (_, index) =>
    buildIndexRow(firstId + index, {
      takenAt: day + (8 + index) * 3600_000
    })
  )

describe('getGalleryAlbumSuggestions: activity windows', () => {
  const owner = { id: 'https://llun.test/users/owner' }
  const NEWEST = Date.UTC(2026, 8, 20)
  const OLDEST = Date.UTC(2020, 0, 6)

  it('finds an activity day that is the newest of more activities than one window holds', async () => {
    // 2,500 activities, one a day from 2020, oldest first: the old read, which
    // took the first 2,000 of them, never reached the newest day.
    const activities = Array.from(
      { length: 2500 },
      (_, index) => OLDEST + index * DAY + 7 * 3600_000
    )
    const newestActivity = activities[activities.length - 1]
    expect(newestActivity).toBeGreaterThan(NEWEST)
    const rows = [
      ...photosOnDay(1, OLDEST, 5),
      // The newest photo day is the last activity's day.
      ...photosOnDay(100, Math.floor(newestActivity / DAY) * DAY, 5)
    ]
    const { database, windows } = buildDatabase({
      owner: () => rows,
      activities
    })

    const { suggestions } = await getGalleryAlbumSuggestions({
      database,
      owner
    })

    const newestKey = new Date(newestActivity).toISOString().slice(0, 10)
    expect(suggestions.map((suggestion) => suggestion.id)).toEqual([
      `activity_day:${newestKey}`,
      `activity_day:${new Date(OLDEST).toISOString().slice(0, 10)}`
    ])
    expect(suggestions[0]).toMatchObject({ activityCount: 1, photoCount: 5 })
    // Two windows of a month at most each, not a walk through 2,500 activities.
    expect(windows).toHaveLength(2)
    for (const window of windows) {
      expect(window.endDate - window.startDate).toBeLessThanOrEqual(31 * DAY)
    }
    // Newest window first.
    expect(windows[0].startDate).toBeGreaterThan(windows[1].startDate)
  })

  it('asks only for the windows of the newest photo days, and stops once enough days matched', async () => {
    // Twenty photo days, 40 days apart, each with an activity: one window each.
    const days = Array.from(
      { length: 20 },
      (_, index) => Date.UTC(2024, 0, 1) + index * 40 * DAY
    )
    const rows = days.flatMap((day, index) =>
      photosOnDay(index * 10 + 1, day, 5)
    )
    const { database, windows } = buildDatabase({
      owner: () => rows,
      activities: days.map((day) => day + 7 * 3600_000)
    })

    const { suggestions } = await getGalleryAlbumSuggestions({
      database,
      owner
    })

    expect(suggestions).toHaveLength(MAX_SUGGESTIONS_PER_KIND)
    expect(windows).toHaveLength(MAX_SUGGESTIONS_PER_KIND)
    // The six newest days.
    expect(suggestions[0].firstAt).toBe(
      new Date(days[19] + 8 * 3600_000).toISOString()
    )
  })

  it('bounds the number of windows when few days match', async () => {
    const days = Array.from(
      { length: 40 },
      (_, index) => Date.UTC(2023, 0, 1) + index * 40 * DAY
    )
    const rows = days.flatMap((day, index) =>
      photosOnDay(index * 10 + 1, day, 5)
    )
    const { database, windows } = buildDatabase({ owner: () => rows })

    const { suggestions } = await getGalleryAlbumSuggestions({
      database,
      owner
    })

    expect(suggestions).toEqual([])
    expect(windows).toHaveLength(12)
  })

  it('merges adjacent photo days into one window and reads its pages', async () => {
    // Ten days in a row with five photos and 130 activities between them: one
    // window, two pages.
    const first = Date.UTC(2026, 5, 1)
    const rows = Array.from({ length: 10 }, (_, index) =>
      photosOnDay(index * 10 + 1, first + index * DAY, 5)
    ).flat()
    const activities = Array.from(
      { length: 130 },
      (_, index) => first + Math.floor(index / 13) * DAY + 6 * 3600_000 + index
    )
    const { database, windows } = buildDatabase({
      owner: () => rows,
      activities
    })

    const { suggestions } = await getGalleryAlbumSuggestions({
      database,
      owner
    })

    expect(windows.map((window) => window.offset)).toEqual([0, 100])
    const days = suggestions.filter(
      (suggestion) => suggestion.kind === 'activity_day'
    )
    expect(days).toHaveLength(MAX_SUGGESTIONS_PER_KIND)
    expect(days.every((day) => day.activityCount === 13)).toBeTrue()
  })

  it('ignores an activity with no usable start time', async () => {
    const day = Date.UTC(2026, 5, 1)
    const { database } = buildDatabase({
      owner: () => photosOnDay(1, day, 5),
      activities: [day + 7 * 3600_000]
    })
    const calls = (
      database as never as {
        getFitnessActivitiesInWindow: ReturnType<typeof vi.fn>
      }
    ).getFitnessActivitiesInWindow
    calls.mockResolvedValueOnce({
      activities: [
        { startTime: Number.NaN },
        { startTime: day + 7 * 3600_000 }
      ],
      hasMore: false
    })

    const { suggestions } = await getGalleryAlbumSuggestions({
      database,
      owner
    })

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({
      kind: 'activity_day',
      activityCount: 1,
      // The fake serves no photo, so there is no preview to project.
      preview: null
    })
  })
})

describe('getGalleryAlbumSuggestions: index windows and long clusters', () => {
  const owner = { id: 'https://llun.test/users/owner' }

  it('reads a second index window with the last id as the cursor, and stops at a short one', async () => {
    const first = Array.from({ length: GALLERY_INDEX_CAP }, (_, index) =>
      buildIndexRow(100_000 - index, { takenAt: null })
    )
    const second = photosOnDay(1, Date.UTC(2026, 5, 1), 8)
    const { database, indexCalls } = buildDatabase({
      owner: (maxId) => (maxId === undefined ? first : second)
    })

    const { suggestions } = await getGalleryAlbumSuggestions({
      database,
      owner
    })

    const ownerCalls = indexCalls.filter((call) => call.audience === 'owner')
    expect(ownerCalls.map((call) => call.maxId)).toEqual([
      undefined,
      String(100_000 - GALLERY_INDEX_CAP + 1)
    ])
    // The photos of the second window are part of the suggestions.
    expect(suggestions.map((suggestion) => suggestion.kind)).toEqual(['trip'])
    expect(suggestions[0].photoCount).toBe(8)
  })

  it('asks which albums hold only the photos of the candidates, not the whole gallery', async () => {
    const trip = photosOnDay(1, Date.UTC(2026, 5, 1), 8)
    const others = Array.from({ length: 30 }, (_, index) =>
      buildIndexRow(500 + index, { takenAt: null })
    )
    const { database } = buildDatabase({ owner: () => [...trip, ...others] })

    await getGalleryAlbumSuggestions({ database, owner })

    const sets = (
      database as never as {
        getGalleryAlbumItemSets: ReturnType<typeof vi.fn>
      }
    ).getGalleryAlbumItemSets
    expect(sets).toHaveBeenCalledTimes(1)
    expect(sets.mock.calls[0][0].actorId).toBe(owner.id)
    expect([...sets.mock.calls[0][0].mediaIds].sort()).toEqual(
      trip.map((row) => row.id).sort()
    )
  })

  it('does not ask which albums hold anything when there are no candidates', async () => {
    const { database } = buildDatabase({
      owner: () => [buildIndexRow(1), buildIndexRow(2)]
    })

    const { suggestions } = await getGalleryAlbumSuggestions({
      database,
      owner
    })

    expect(suggestions).toEqual([])
    expect(
      (
        database as never as {
          getGalleryAlbumItemSets: ReturnType<typeof vi.fn>
        }
      ).getGalleryAlbumItemSets
    ).not.toHaveBeenCalled()
  })

  it('cuts a cluster past what an album holds to its newest photos', async () => {
    const total = MAX_SUGGESTION_MEDIA_IDS + 1
    const start = Date.UTC(2026, 5, 1)
    // 2,001 photos a minute apart: one trip, the newest photo has the highest id.
    const rows = Array.from({ length: total }, (_, index) =>
      buildIndexRow(index + 1, { takenAt: start + index * 60_000 })
    )
    const { database } = buildDatabase({ owner: () => rows })

    const { suggestions } = await getGalleryAlbumSuggestions({
      database,
      owner
    })

    const trip = suggestions.find((suggestion) => suggestion.kind === 'trip')
    expect(trip).toMatchObject({ photoCount: total, truncated: true })
    expect(trip!.mediaIds).toHaveLength(MAX_SUGGESTION_MEDIA_IDS)
    expect(trip!.mediaIds[0]).toBe(String(total))
    // The oldest photo is the one left out.
    expect(trip!.mediaIds).not.toContain('1')
  })
})
