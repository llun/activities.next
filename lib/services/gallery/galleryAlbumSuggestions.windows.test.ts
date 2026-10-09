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

// An activity is its start time, or the time and the post it was published as.
type FakeActivity = number | { startTime: number; statusId: string }

const startOf = (activity: FakeActivity) =>
  typeof activity === 'number' ? activity : activity.startTime

const buildDatabase = ({
  owner,
  publicIndex = owner,
  activities = [],
  albums = [],
  statuses = {}
}: {
  owner: (maxId?: string) => GalleryIndexRow[]
  publicIndex?: (maxId?: string) => GalleryIndexRow[]
  activities?: FakeActivity[]
  albums?: Array<{ albumId: string; mediaIds: string[] }>
  // The audience of each post an activity may have been published as.
  statuses?: Record<string, { to: string[] }>
}) => {
  const windows: Window[] = []
  const indexCalls: Array<{ audience: string; maxId?: string }> = []
  const sorted = [...activities].sort((a, b) => startOf(a) - startOf(b))
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
      getGalleryAlbumItemSets: vi.fn(async () => albums),
      getStatus: vi.fn(async ({ statusId }: { statusId: string }) => {
        const status = statuses[statusId]
        return status
          ? { id: statusId, type: 'Note', to: status.to, cc: [] }
          : null
      }),
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
          const inside = sorted.filter(
            (activity) =>
              startOf(activity) >= startDate && startOf(activity) < endDate
          )
          return {
            activities: inside
              .slice(offset, offset + limit)
              .map((activity) =>
                typeof activity === 'number'
                  ? { startTime: activity }
                  : activity
              ),
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

describe('getGalleryAlbumSuggestions: activity-day titles and coverage', () => {
  const owner = { id: 'https://llun.test/users/owner' }
  const DAY_START = Date.UTC(2026, 5, 1)
  const PUBLIC = 'https://www.w3.org/ns/activitystreams#Public'

  const getStatusMock = (database: unknown) =>
    (database as { getStatus: ReturnType<typeof vi.fn> }).getStatus

  it('says "Activity day" when any of the day\u2019s activities is on a public post, and reads posts with replies off', async () => {
    const { database } = buildDatabase({
      owner: () => photosOnDay(1, DAY_START, 5),
      activities: [
        { startTime: DAY_START + 6 * 3600_000, statusId: 'private-post' },
        { startTime: DAY_START + 7 * 3600_000, statusId: 'public-post' }
      ],
      statuses: {
        'private-post': { to: [`${owner.id}/followers`] },
        'public-post': { to: [PUBLIC] }
      }
    })

    const { suggestions } = await getGalleryAlbumSuggestions({
      database,
      owner
    })

    expect(suggestions[0]).toMatchObject({
      kind: 'activity_day',
      title: 'Activity day, 1 Jun 2026',
      activityCount: 2
    })
    expect(getStatusMock(database)).toHaveBeenCalledWith({
      statusId: 'public-post',
      withReplies: false
    })
  })

  it('names the day by its date alone when no activity is on a public post, or the post is gone', async () => {
    const { database } = buildDatabase({
      owner: () => photosOnDay(1, DAY_START, 5),
      activities: [
        { startTime: DAY_START + 6 * 3600_000, statusId: 'private-post' },
        { startTime: DAY_START + 7 * 3600_000, statusId: 'deleted-post' }
      ],
      statuses: { 'private-post': { to: [`${owner.id}/followers`] } }
    })

    const { suggestions } = await getGalleryAlbumSuggestions({
      database,
      owner
    })

    expect(suggestions[0].title).toBe('1 Jun 2026')
  })

  it('does not look at a post for a day that is not suggested', async () => {
    const { database } = buildDatabase({
      owner: () => photosOnDay(1, DAY_START, 5),
      activities: []
    })

    await getGalleryAlbumSuggestions({ database, owner })

    expect(getStatusMock(database)).not.toHaveBeenCalled()
  })

  it('leaves out an activity day that one album already holds, and shows an older matching day instead', async () => {
    const older = DAY_START - 40 * DAY
    const newer = photosOnDay(1, DAY_START, 5)
    const rows = [...newer, ...photosOnDay(100, older, 5)]
    const { database, windows } = buildDatabase({
      owner: () => rows,
      activities: [DAY_START + 7 * 3600_000, older + 7 * 3600_000],
      albums: [{ albumId: 'album', mediaIds: newer.map((row) => row.id) }]
    })

    const { suggestions } = await getGalleryAlbumSuggestions({
      database,
      owner
    })

    expect(suggestions.map((suggestion) => suggestion.id)).toEqual([
      'activity_day:2026-04-22'
    ])
    // Only the older day's window was read: the covered day cost no lookup.
    expect(windows).toHaveLength(1)
    expect(windows[0].startDate).toBeLessThanOrEqual(older)
    expect(windows[0].endDate).toBeLessThan(DAY_START)
  })

  it('keeps an activity day an album holds only part of', async () => {
    const rows = photosOnDay(1, DAY_START, 5)
    const { database } = buildDatabase({
      owner: () => rows,
      activities: [DAY_START + 7 * 3600_000],
      albums: [{ albumId: 'album', mediaIds: rows.slice(1).map((r) => r.id) }]
    })

    const { suggestions } = await getGalleryAlbumSuggestions({
      database,
      owner
    })

    expect(suggestions.map((suggestion) => suggestion.kind)).toEqual([
      'activity_day'
    ])
  })

  describe('matching a photo day to the activities of two readings', () => {
    // Five photos from 18:00 to 22:00 UTC on 5 Mar: 5 Mar by their UTC date, and
    // 03:00 to 07:00 on 6 Mar in Tokyo.
    const photos = Array.from({ length: 5 }, (_, index) =>
      buildIndexRow(index + 1, { takenAt: Date.UTC(2026, 2, 5, 18 + index) })
    )
    // 09:00 on 5 Mar in Tokyo, and 07:00 on 6 Mar in Tokyo.
    const onFifth = Date.UTC(2026, 2, 5, 0)
    const onSixth = Date.UTC(2026, 2, 5, 22)

    it('falls back to the viewer-local day when the UTC date has no activity', async () => {
      const { database } = buildDatabase({
        owner: () => photos,
        activities: [{ startTime: onSixth, statusId: 'public-post' }],
        statuses: { 'public-post': { to: [PUBLIC] } }
      })

      const { suggestions } = await getGalleryAlbumSuggestions({
        database,
        owner,
        timeZone: 'Asia/Tokyo'
      })

      expect(suggestions).toHaveLength(1)
      expect(suggestions[0]).toMatchObject({
        id: 'activity_day:2026-03-05',
        title: 'Activity day, 5 Mar 2026',
        activityCount: 1
      })
    })

    it('counts only the UTC date’s activities when it has some, and takes its public post from them alone', async () => {
      const { database } = buildDatabase({
        owner: () => photos,
        activities: [
          { startTime: onFifth, statusId: 'private-post' },
          { startTime: onSixth, statusId: 'public-post' }
        ],
        statuses: {
          'private-post': { to: [`${owner.id}/followers`] },
          'public-post': { to: [PUBLIC] }
        }
      })

      const { suggestions } = await getGalleryAlbumSuggestions({
        database,
        owner,
        timeZone: 'Asia/Tokyo'
      })

      expect(suggestions).toHaveLength(1)
      // One activity, not two, and the 6 Mar post is not read: no "Activity day".
      expect(suggestions[0]).toMatchObject({
        id: 'activity_day:2026-03-05',
        title: '5 Mar 2026',
        activityCount: 1
      })
      expect(getStatusMock(database)).not.toHaveBeenCalledWith(
        expect.objectContaining({ statusId: 'public-post' })
      )
    })

    it('finds no activity for a viewer in a zone where neither reading has one', async () => {
      const { database } = buildDatabase({
        owner: () => photos,
        activities: [{ startTime: Date.UTC(2026, 2, 20), statusId: 'p' }]
      })

      const { suggestions } = await getGalleryAlbumSuggestions({
        database,
        owner,
        timeZone: 'Asia/Tokyo'
      })

      expect(suggestions).toEqual([])
    })
  })

  it('titles a species by the name of a photo a visitor can see, not the owner’s newest', async () => {
    const species = (id: number, name: string) =>
      buildIndexRow(id, {
        subjectName: name,
        subjectScientificName: 'Bubo bubo',
        takenAt: Date.UTC(2020 + id, 0, 1)
      })
    // The newest photo (a followers-only one) has the owner's own name for it.
    const rows = [
      species(1, 'Eagle-owl'),
      species(2, 'Eagle-owl'),
      species(3, 'Eagle-owl'),
      species(4, 'Eagle-owl'),
      species(5, 'Barn at night')
    ]
    const { database } = buildDatabase({
      owner: () => rows,
      publicIndex: () => rows.slice(0, 4)
    })

    const { suggestions } = await getGalleryAlbumSuggestions({
      database,
      owner
    })

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({ kind: 'species' })
    expect(suggestions[0].title).toBe('Eagle-owl')
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

  describe('a cluster past what an album holds', () => {
    const total = MAX_SUGGESTION_MEDIA_IDS + 1
    const start = Date.UTC(2026, 5, 1)
    // 2,001 photos a day apart (so no day has enough photos to be a suggestion of
    // its own): one trip, and the newest photo has the highest id.
    const rows = Array.from({ length: total }, (_, index) =>
      buildIndexRow(index + 1, { takenAt: start + index * DAY })
    )
    const newest = rows
      .slice(1)
      .reverse()
      .map((row) => row.id)

    it('treats an album that holds every photo the suggestion offers as covering it', async () => {
      // An album with the newest 2,000 photos: all the dialog can be handed.
      const { database } = buildDatabase({
        owner: () => rows,
        albums: [{ albumId: 'album', mediaIds: newest }]
      })

      const { suggestions } = await getGalleryAlbumSuggestions({
        database,
        owner
      })

      expect(suggestions).toEqual([])
    })

    it('only asks about the offered photos, and keeps the suggestion when an album misses one of them', async () => {
      const { database } = buildDatabase({
        owner: () => rows,
        // The oldest of the offered photos is missing, and the left-out oldest
        // photo is present: not a cover.
        albums: [{ albumId: 'album', mediaIds: [...newest.slice(0, -1), '1'] }]
      })

      const { suggestions } = await getGalleryAlbumSuggestions({
        database,
        owner
      })

      const sets = (
        database as never as {
          getGalleryAlbumItemSets: ReturnType<typeof vi.fn>
        }
      ).getGalleryAlbumItemSets
      expect(sets.mock.calls[0][0].mediaIds).toHaveLength(
        MAX_SUGGESTION_MEDIA_IDS
      )
      expect(sets.mock.calls[0][0].mediaIds).not.toContain('1')
      expect(suggestions.map((suggestion) => suggestion.kind)).toEqual(['trip'])
    })
  })
})
