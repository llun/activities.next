import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { MAX_SUGGESTIONS_PER_KIND } from '@/lib/services/gallery/galleryAlbumSuggestionEntities'
import {
  getGalleryAlbumSuggestions,
  getGallerySuggestionMedia
} from '@/lib/services/gallery/galleryAlbumSuggestions'
import { toTakenAt } from '@/lib/services/medias/exif/readMediaExif'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { MediaDetailsRecord } from '@/lib/types/database/gallery'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('getGalleryAlbumSuggestions', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    // The owner of the shared, read-only data set. A test that changes data
    // uses an actor of its own below.
    const ownerId: string = actors.empty.id
    const strangerId: string = actors.extra.id
    const coverageOwnerId: string = actors.pollAuthor.id
    const capOwnerId: string = actors.replyAuthor.id
    const ids: Record<string, string> = {}

    let counter = 0
    const addPhoto = async ({
      actorId = ownerId,
      name,
      to = [ACTIVITY_STREAM_PUBLIC],
      details,
      lookup = { status: 'resolved', iucn: 'LC' },
      attach = true
    }: {
      actorId?: string
      name: string
      to?: string[]
      details: Partial<MediaDetailsRecord>
      lookup?: { status: 'resolved' | 'pending' | 'failed'; iucn?: 'CR' | 'LC' }
      attach?: boolean
    }) => {
      counter += 1
      const media = await database.createMedia({
        actorId,
        original: {
          path: `/test/suggestions-${counter}.jpg`,
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: { width: 100, height: 100 }
        },
        details: { inGallery: true, ...details }
      })
      ids[name] = media!.id
      if (details.subjectName) {
        await database.setMediaSubjectLookup({
          mediaId: media!.id,
          expect: {
            subjectName: details.subjectName ?? null,
            subjectScientificName: details.subjectScientificName ?? null,
            subjectTaxonKey: null
          },
          patch: {
            subjectLookupStatus: lookup.status,
            subjectIucnCategory: lookup.iucn ?? null
          }
        })
      }
      const statusId = `${actorId}/statuses/suggestions-${counter}`
      if (attach) {
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId,
          to,
          cc: [],
          text: name
        })
        await database.createAttachment({
          actorId,
          statusId,
          mediaType: 'image/jpeg',
          url: `https://media.test/suggestions-${counter}.jpg`,
          width: 100,
          height: 100,
          mediaId: media!.id
        })
      }
      return { mediaId: media!.id, statusId }
    }

    // `count` photos, one every `everyHours` hours from `start`.
    const addRun = async (
      prefix: string,
      count: number,
      start: number,
      everyHours: number,
      extra: Partial<MediaDetailsRecord> = {},
      options: Partial<Parameters<typeof addPhoto>[0]> = {}
    ) => {
      for (let index = 0; index < count; index += 1) {
        await addPhoto({
          name: `${prefix}-${index}`,
          details: {
            takenAt: start + index * everyHours * 3600_000,
            ...extra
          },
          ...options
        })
      }
    }

    // The post an activity was published as: public, or followers-only.
    const addActivityPost = async (
      actorId: string,
      audience: 'public' | 'followers'
    ) => {
      counter += 1
      const statusId = `${actorId}/statuses/suggestions-activity-${counter}`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId,
        to:
          audience === 'public'
            ? [ACTIVITY_STREAM_PUBLIC]
            : [`${actorId}/followers`],
        cc: [],
        text: 'Morning run'
      })
      return statusId
    }

    const addActivity = async (
      actorId: string,
      startTime: Date,
      overrides: {
        status?: 'completed' | 'failed' | 'pending'
        post?: 'public' | 'followers'
      } = {}
    ) => {
      counter += 1
      const file = await database.createFitnessFile({
        actorId,
        path: `fitness/suggestions-${counter}.fit`,
        fileName: `suggestions-${counter}.fit`,
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 100
      })
      await database.updateFitnessFileActivityData(file!.id, {
        activityType: 'running',
        activityStartTime: startTime
      })
      await database.updateFitnessFileProcessingStatus(
        file!.id,
        overrides.status ?? 'completed'
      )
      if (overrides.post) {
        await database.updateFitnessFileStatus(
          file!.id,
          await addActivityPost(actorId, overrides.post)
        )
      }
      return file!.id
    }

    const suggest = async (
      options: {
        actorId?: string
        timeZone?: string
      } = {}
    ) =>
      (
        await getGalleryAlbumSuggestions({
          database,
          owner: { id: options.actorId ?? ownerId },
          timeZone: options.timeZone
        })
      ).suggestions

    const byId = (
      suggestions: Awaited<ReturnType<typeof suggest>>,
      id: string
    ) => suggestions.find((suggestion) => suggestion.id === id)

    const kruger = {
      placeName: 'Kruger',
      placeLatitude: -24.99,
      placeLongitude: 31.59,
      placePrecision: 'exact',
      placeNameSource: 'owner'
    } as const

    const satara = {
      placeName: 'Satara',
      placeLatitude: -24.4,
      placeLongitude: 31.78,
      placePrecision: 'exact',
      placeNameSource: 'owner'
    } as const

    // The `takenAt` of a photo whose EXIF carries a UTC offset: the real
    // instant, which is what `readMediaExif` stores. The wall clock is given the
    // way exifr revives it, in the process's zone.
    const exifInstant = (
      year: number,
      month: number,
      day: number,
      hour: number,
      minute: number,
      offset: string
    ) =>
      (
        toTakenAt(new Date(year, month, day, hour, minute), offset) as Date
      ).getTime()

    beforeAll(async () => {
      await seedDatabase(database)

      // A trip: nine photos from 12 to 19 Sep 2026 with gaps of up to three
      // days, all at one public place, two of them of a Least Concern bird.
      await addRun('kruger', 9, Date.UTC(2026, 8, 12, 6), 21, kruger)
      await addPhoto({
        name: 'kruger-bird',
        details: {
          subjectName: 'Lilac-breasted roller',
          subjectScientificName: 'Coracias caudatus',
          subjectCategory: 'bird',
          takenAt: Date.UTC(2026, 8, 13, 9),
          ...kruger
        }
      })

      // A trip in August with one photo of a critically endangered species:
      // the title must not name the place.
      await addRun('august', 7, Date.UTC(2026, 7, 3, 8), 20, kruger)
      await addPhoto({
        name: 'august-leopard',
        details: {
          subjectName: 'Amur leopard',
          subjectScientificName: 'Panthera pardus orientalis',
          subjectCategory: 'mammal',
          takenAt: Date.UTC(2026, 7, 4, 8),
          placeName: 'Secret ridge',
          placeLatitude: 43.1,
          placeLongitude: 131.9,
          placePrecision: 'exact',
          placeNameSource: 'owner'
        },
        lookup: { status: 'resolved', iucn: 'CR' }
      })

      // Seven photos in June: below the minimum of eight.
      await addRun('june', 7, Date.UTC(2026, 5, 2, 8), 20, kruger)

      // A species series: five photos of one bird, a month apart, so no trip.
      for (let month = 0; month < 5; month += 1) {
        await addPhoto({
          name: `swallow-${month}`,
          details: {
            subjectName: 'Barn swallow',
            subjectScientificName: 'Hirundo rustica',
            subjectCategory: 'bird',
            takenAt: Date.UTC(2025, month * 2, 5, 10)
          }
        })
      }
      // Five of an owl, all in followers-only posts: nothing a visitor can see.
      for (let month = 0; month < 5; month += 1) {
        await addPhoto({
          name: `owl-${month}`,
          to: [`${ownerId}/followers`],
          details: {
            subjectName: 'Eurasian eagle-owl',
            subjectScientificName: 'Bubo bubo',
            subjectCategory: 'bird',
            takenAt: Date.UTC(2023, month * 2, 5, 10)
          }
        })
      }
      // Four of another: below the threshold.
      for (let month = 0; month < 4; month += 1) {
        await addPhoto({
          name: `heron-${month}`,
          details: {
            subjectName: 'Grey heron',
            subjectScientificName: 'Ardea cinerea',
            subjectCategory: 'bird',
            takenAt: Date.UTC(2024, month * 2, 5, 10)
          }
        })
      }

      // Activity days. Six photos on 4 Jul with a run that day; six on 20 Jul
      // with no activity; five on 30 Jul whose only activity failed processing.
      await addRun('run', 6, Date.UTC(2026, 6, 4, 6), 1)
      await addActivity(ownerId, new Date(Date.UTC(2026, 6, 4, 8)), {
        post: 'public'
      })
      await addRun('quiet', 6, Date.UTC(2026, 6, 20, 6), 1)
      await addRun('failed-run', 5, Date.UTC(2026, 6, 30, 6), 1)
      await addActivity(ownerId, new Date(Date.UTC(2026, 6, 30, 8)), {
        status: 'failed'
      })
      // Five photos on 3 Mar 2026 (UTC) with a run that starts at 23:30 UTC
      // on 2 Mar, which is the morning of 3 Mar in Tokyo.
      await addRun('tokyo', 5, Date.UTC(2026, 2, 3, 6), 1)
      await addActivity(ownerId, new Date(Date.UTC(2026, 2, 2, 23, 30)))

      // A Tokyo morning, as a phone records it: `takenAt` is the real instant
      // (EXIF with a +09:00 offset), so six photos from 07:00 to 08:40 on 21 Feb
      // are on 20 Feb in UTC, and a run at 07:05 JST is too.
      for (let index = 0; index < 6; index += 1) {
        await addPhoto({
          name: `jog-${index}`,
          details: {
            takenAt: exifInstant(2026, 1, 21, 7, index * 20, '+09:00')
          }
        })
      }
      await addActivity(
        ownerId,
        new Date(exifInstant(2026, 1, 21, 7, 5, '+09:00')),
        { post: 'public' }
      )

      // Six photos on 18 Aug with a run published to followers only, and six
      // followers-only photos on 25 Nov with a public run: neither title may
      // say there was an activity (the first) or give a date (the second).
      await addRun('private-run', 6, Date.UTC(2026, 7, 18, 6), 1)
      await addActivity(ownerId, new Date(Date.UTC(2026, 7, 18, 8)), {
        post: 'followers'
      })
      await addRun(
        'private-photos',
        6,
        Date.UTC(2026, 10, 25, 6),
        1,
        {},
        { to: [`${ownerId}/followers`] }
      )
      await addActivity(ownerId, new Date(Date.UTC(2026, 10, 25, 8)), {
        post: 'public'
      })

      // A trip through two public places: every name is public for its own
      // photo, so none of them names the trip.
      await addRun('mixed-a', 4, Date.UTC(2026, 9, 2, 8), 20, kruger)
      await addRun('mixed-b', 4, Date.UTC(2026, 9, 6, 8), 20, satara)

      // Six public photos with no place and two followers-only ones a few days
      // later: the title's dates are those of the public photos.
      await addRun('vis-dates', 6, Date.UTC(2026, 9, 20, 8), 8)
      for (const [name, day] of [
        ['vis-dates-private-a', 24],
        ['vis-dates-private-b', 25]
      ] as const) {
        await addPhoto({
          name,
          to: [`${ownerId}/followers`],
          details: { takenAt: Date.UTC(2026, 9, day, 8) }
        })
      }
      // Six public photos at Kruger and two followers-only ones at a private
      // cabin: the title may name Kruger, never the cabin.
      await addRun('vis-place', 6, Date.UTC(2026, 11, 10, 8), 8, kruger)
      for (const [name, day] of [
        ['vis-place-private-a', 13],
        ['vis-place-private-b', 14]
      ] as const) {
        await addPhoto({
          name,
          to: [`${ownerId}/followers`],
          details: {
            takenAt: Date.UTC(2026, 11, day, 8),
            placeName: 'Private cabin',
            placeLatitude: 61.5,
            placeLongitude: 24.5,
            placePrecision: 'exact',
            placeNameSource: 'owner'
          }
        })
      }

      // Out of scope, in a run that would otherwise be a trip: another
      // account's photos, a deleted post's, ones out of the gallery, an
      // unposted upload, and a followers-only post's (the owner still sees it).
      await addRun(
        'stranger',
        10,
        Date.UTC(2026, 10, 1, 8),
        10,
        {},
        {
          actorId: strangerId
        }
      )
      const deleted: string[] = []
      for (let index = 0; index < 10; index += 1) {
        const { statusId } = await addPhoto({
          name: `deleted-${index}`,
          details: { takenAt: Date.UTC(2026, 0, 10, 8 + index) }
        })
        deleted.push(statusId)
      }
      for (const statusId of deleted) await database.deleteStatus({ statusId })
      for (let index = 0; index < 10; index += 1) {
        await addPhoto({
          name: `hidden-${index}`,
          details: {
            inGallery: false,
            takenAt: Date.UTC(2026, 1, 10, 8 + index)
          }
        })
      }
      for (let index = 0; index < 10; index += 1) {
        await addPhoto({
          name: `unposted-${index}`,
          attach: false,
          details: { takenAt: Date.UTC(2026, 3, 10, 8 + index) }
        })
      }
      await addRun(
        'followers',
        8,
        Date.UTC(2026, 4, 10, 8),
        5,
        {},
        {
          to: [`${ownerId}/followers`]
        }
      )
    })

    afterAll(async () => {
      await database.destroy()
    })

    it('suggests a trip from photos with no gap of more than three days, named by its public place', async () => {
      const trip = byId(await suggest(), 'trip:2026-09-12')

      expect(trip).toMatchObject({
        kind: 'trip',
        title: 'Kruger, September 2026',
        photoCount: 10,
        placeCount: 1,
        speciesCount: 1,
        activityCount: 0,
        truncated: false
      })
      expect(trip!.mediaIds).toHaveLength(10)
      // Newest first, so the newest photo is the cover once used.
      expect(trip!.preview?.mediaId).toBe(trip!.mediaIds[0])
      expect(trip!.firstAt).toBe('2026-09-12T06:00:00.000Z')
      expect(new Date(trip!.lastAt as string).getTime()).toBeGreaterThan(
        Date.UTC(2026, 8, 18)
      )
    })

    it('falls back to a dates title when one photo of the trip has a withheld place, and counts no place for it', async () => {
      const trip = byId(await suggest(), 'trip:2026-08-03')

      expect(trip).toMatchObject({ kind: 'trip', photoCount: 8 })
      expect(trip!.title).toBe('Trip, 3–8 Aug 2026')
      expect(JSON.stringify(trip)).not.toContain('Secret ridge')
      // The eight photos have two places stored, but the leopard's is withheld.
      expect(trip!.placeCount).toBe(1)
    })

    it('leaves out a run below the minimum size', async () => {
      const suggestions = await suggest()

      expect(
        suggestions
          .filter((suggestion) => suggestion.id.startsWith('trip:'))
          .map((suggestion) => suggestion.id)
      ).toEqual([
        'trip:2026-12-10',
        'trip:2026-10-20',
        'trip:2026-10-02',
        'trip:2026-09-12',
        'trip:2026-08-03',
        'trip:2026-05-10'
      ])
    })

    it('suggests a species with five photos, titled by its name alone, and not one with four', async () => {
      const suggestions = await suggest()
      const swallow = byId(suggestions, 'species:sci:hirundo rustica')

      expect(swallow).toMatchObject({
        kind: 'species',
        title: 'Barn swallow',
        photoCount: 5,
        speciesCount: 1
      })
      expect(byId(suggestions, 'species:sci:ardea cinerea')).toBeUndefined()
    })

    it('suggests a day with a recorded activity and enough photos, and skips the others', async () => {
      const suggestions = await suggest()

      expect(byId(suggestions, 'activity_day:2026-07-04')).toMatchObject({
        kind: 'activity_day',
        title: 'Activity day, 4 Jul 2026',
        photoCount: 6,
        activityCount: 1,
        placeCount: 0
      })
      // No activity that day, and an activity that failed processing.
      expect(byId(suggestions, 'activity_day:2026-07-20')).toBeUndefined()
      expect(byId(suggestions, 'activity_day:2026-07-30')).toBeUndefined()
    })

    it('finds the activity of a photo with no UTC offset on the viewer-local day, the photo stored as its wall clock', async () => {
      // Five photos at 06:00 to 10:00 on 3 Mar with no EXIF offset (the camera's
      // wall clock, stored as UTC), and a run at 08:30 on 3 Mar in Tokyo, which
      // is 23:30 UTC on 2 Mar. In Tokyo the run is on the photos' day.
      expect(byId(await suggest(), 'activity_day:2026-03-03')).toBeUndefined()

      expect(
        byId(
          await suggest({ timeZone: 'Asia/Tokyo' }),
          'activity_day:2026-03-03'
        )
      ).toMatchObject({ kind: 'activity_day', photoCount: 5, activityCount: 1 })
    })

    it('finds the activity of a photo with a UTC offset on the viewer-local day, and shows the album’s UTC date', async () => {
      // Six photos from 07:00 to 08:40 on 21 Feb in Tokyo, stored as the real
      // instant (EXIF with a +09:00 offset): 20 Feb in UTC, which is the date
      // the album shows. A run at 07:05 that morning meets them in Tokyo (the
      // photos' local day), and in UTC and Los Angeles (the run's day there is
      // 20 Feb as well).
      for (const timeZone of ['Asia/Tokyo', 'UTC', 'America/Los_Angeles']) {
        const suggestions = await suggest({ timeZone })
        const day = byId(suggestions, 'activity_day:2026-02-20')

        expect(day, timeZone).toMatchObject({
          kind: 'activity_day',
          title: 'Activity day, 20 Feb 2026',
          photoCount: 6,
          activityCount: 1
        })
        // Title and meta line agree: the first photo is on 20 Feb UTC.
        expect(day!.firstAt, timeZone).toBe('2026-02-20T22:00:00.000Z')
        expect(byId(suggestions, 'activity_day:2026-02-21'), timeZone).toBe(
          undefined
        )
      }
    })

    it('says "Activity day" only when one of the activities is on a post visitors can read', async () => {
      const suggestions = await suggest()

      // A followers-only activity: the title is just the date.
      expect(byId(suggestions, 'activity_day:2026-08-18')).toMatchObject({
        kind: 'activity_day',
        title: '18 Aug 2026',
        activityCount: 1
      })
      // A public activity: the words are fine.
      expect(byId(suggestions, 'activity_day:2026-07-04')!.title).toBe(
        'Activity day, 4 Jul 2026'
      )
    })

    it('gives a day with no photo a visitor can see a generic title with no date', async () => {
      const day = byId(await suggest(), 'activity_day:2026-11-25')

      expect(day).toMatchObject({
        kind: 'activity_day',
        title: 'Day out',
        photoCount: 6
      })
    })

    it('names no place for a trip through two public places, and gives it a dates title', async () => {
      const trip = byId(await suggest(), 'trip:2026-10-02')

      expect(trip).toMatchObject({ kind: 'trip', photoCount: 8, placeCount: 2 })
      expect(trip!.title).toBe('Trip, 2–8 Oct 2026')
    })

    it('takes a trip title’s dates from the photos a visitor can see, and its place from them too', async () => {
      const suggestions = await suggest()

      // Eight photos for the owner, two of them followers-only a few days later.
      const dates = byId(suggestions, 'trip:2026-10-20')
      expect(dates).toMatchObject({ photoCount: 8 })
      expect(dates!.title).toBe('Trip, 20–22 Oct 2026')

      const place = byId(suggestions, 'trip:2026-12-10')
      expect(place).toMatchObject({ photoCount: 8 })
      expect(place!.title).toBe('Kruger, December 2026')
      // (The owner's own preview still shows the cabin: it is theirs.)
      expect(place!.title).not.toContain('cabin')
    })

    it('lists suggestions most recent first', async () => {
      const suggestions = await suggest()
      const lastTimes = suggestions.map((suggestion) =>
        new Date(suggestion.lastAt as string).getTime()
      )

      expect(lastTimes).toEqual([...lastTimes].sort((a, b) => b - a))
    })

    it("never includes another account's photos, deleted posts, photos out of the gallery or unposted uploads", async () => {
      const suggestions = await suggest()
      const every = suggestions.flatMap((suggestion) => suggestion.mediaIds)

      for (const name of Object.keys(ids)) {
        const included = every.includes(ids[name])
        if (/^(stranger|deleted|hidden|unposted)-/.test(name)) {
          expect(included, name).toBeFalse()
        }
      }
      expect(suggestions.map((suggestion) => suggestion.id)).not.toContain(
        'trip:2026-11-01'
      )
      expect(suggestions.map((suggestion) => suggestion.id)).not.toContain(
        'trip:2026-01-10'
      )
      expect(suggestions.map((suggestion) => suggestion.id)).not.toContain(
        'trip:2026-02-10'
      )
      expect(suggestions.map((suggestion) => suggestion.id)).not.toContain(
        'trip:2026-04-10'
      )
      // The stranger's own gallery has a trip of its own.
      expect(
        byId(await suggest({ actorId: strangerId }), 'trip:2026-11-01')
      ).toMatchObject({ photoCount: 10 })
    })

    it("includes the owner's followers-only posts, which only the owner sees", async () => {
      expect(byId(await suggest(), 'trip:2026-05-10')).toMatchObject({
        kind: 'trip',
        photoCount: 8
      })
    })

    it('gives a suggestion of followers-only photos only a generic title, with no dates, place or species', async () => {
      const suggestions = await suggest()

      expect(byId(suggestions, 'trip:2026-05-10')!.title).toBe('Trip')
      const owls = byId(suggestions, 'species:sci:bubo bubo')
      expect(owls).toMatchObject({ kind: 'species', photoCount: 5 })
      expect(owls!.title).toBe('Species series')
    })

    it('answers an empty list for an owner with no gallery', async () => {
      expect(await suggest({ actorId: actors.followRequester.id })).toEqual([])
    })

    it('leaves out a suggestion that one album already holds in full, and keeps one it holds only part of', async () => {
      const rows = async (prefix: string, count: number) => {
        const created: string[] = []
        for (let index = 0; index < count; index += 1) {
          const { mediaId } = await addPhoto({
            actorId: coverageOwnerId,
            name: `${prefix}-${index}`,
            details: { takenAt: Date.UTC(2026, 5, 1 + index, 9) }
          })
          created.push(mediaId)
        }
        return created
      }
      const june = await rows('cover-june', 9)
      const before = await suggest({ actorId: coverageOwnerId })
      expect(before.map((suggestion) => suggestion.id)).toEqual([
        'trip:2026-06-01'
      ])

      const partial = await database.createGalleryAlbumWithinLimit({
        actorId: coverageOwnerId,
        title: 'Partial',
        limit: 200,
        mediaIds: june.slice(0, 8)
      })
      expect(partial.status).toBe('created')
      expect(
        (await suggest({ actorId: coverageOwnerId })).map((s) => s.id)
      ).toEqual(['trip:2026-06-01'])

      const full = await database.createGalleryAlbumWithinLimit({
        actorId: coverageOwnerId,
        title: 'All of June',
        limit: 200,
        mediaIds: june
      })
      expect(full.status).toBe('created')
      expect(await suggest({ actorId: coverageOwnerId })).toEqual([])
    })

    it('caps each kind at the newest ones', async () => {
      // Eight single-species runs of five photos, a year apart each, so only
      // the species series qualify.
      for (
        let species = 0;
        species < MAX_SUGGESTIONS_PER_KIND + 2;
        species += 1
      ) {
        for (let photo = 0; photo < 5; photo += 1) {
          await addPhoto({
            actorId: capOwnerId,
            name: `cap-${species}-${photo}`,
            details: {
              subjectName: `Species ${species}`,
              subjectScientificName: `Genus species${species}`,
              takenAt: Date.UTC(2010 + species, photo * 2, 5)
            }
          })
        }
      }

      const suggestions = await suggest({ actorId: capOwnerId })

      expect(suggestions).toHaveLength(MAX_SUGGESTIONS_PER_KIND)
      // The most recent species win the cap.
      expect(suggestions[0].title).toBe(
        `Species ${MAX_SUGGESTIONS_PER_KIND + 1}`
      )
    })

    it('splits and joins trips by calendar day at UTC midnight, whatever the stored timestamp type', async () => {
      const primaryId: string = actors.primary.id
      // 00:01 on 1 Dec to 23:59 on 4 Dec: nearly four days, but three calendar
      // days apart, so one trip.
      await addRun(
        'join-a',
        8,
        Date.UTC(2026, 11, 1, 0, 1),
        0,
        {},
        {
          actorId: primaryId
        }
      )
      await addRun(
        'join-b',
        8,
        Date.UTC(2026, 11, 4, 23, 59),
        0,
        {},
        {
          actorId: primaryId
        }
      )
      // 23:59 on 1 Mar to 00:01 on 5 Mar: just over three days, but four
      // calendar days apart, so two trips.
      await addRun(
        'split-a',
        8,
        Date.UTC(2025, 2, 1, 23, 59),
        0,
        {},
        {
          actorId: primaryId
        }
      )
      await addRun(
        'split-b',
        8,
        Date.UTC(2025, 2, 5, 0, 1),
        0,
        {},
        {
          actorId: primaryId
        }
      )

      const suggestions = await suggest({ actorId: primaryId })

      expect(
        suggestions.map(({ id, photoCount }) => ({ id, photoCount }))
      ).toEqual([
        { id: 'trip:2026-12-01', photoCount: 16 },
        { id: 'trip:2025-03-05', photoCount: 8 },
        { id: 'trip:2025-03-01', photoCount: 8 }
      ])
    })
  })
})

describe('getGallerySuggestionMedia', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    const ownerId: string = actors.empty.id
    const strangerId: string = actors.extra.id
    const ids: Record<string, string> = {}

    const post = async (
      name: string,
      actorId: string,
      inGallery = true,
      attach = true
    ) => {
      const media = await database.createMedia({
        actorId,
        original: {
          path: `/test/suggestion-media-${name}.jpg`,
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: { width: 100, height: 100 }
        },
        details: { inGallery, takenAt: Date.UTC(2026, 8, 1) }
      })
      ids[name] = media!.id
      const statusId = `${actorId}/statuses/suggestion-media-${name}`
      if (!attach) return statusId
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: name
      })
      await database.createAttachment({
        actorId,
        statusId,
        mediaType: 'image/jpeg',
        url: `https://media.test/suggestion-media-${name}.jpg`,
        width: 100,
        height: 100,
        mediaId: media!.id
      })
      return statusId
    }

    beforeAll(async () => {
      await seedDatabase(database)
      await post('first', ownerId)
      await post('second', ownerId)
      await post('foreign', strangerId)
      await post('out', ownerId, false)
      // An upload that was never posted, and one whose post was deleted.
      await post('unposted', ownerId, true, false)
      const goneStatusId = await post('gone', ownerId)
      await database.deleteStatus({ statusId: goneStatusId! })
    })

    afterAll(async () => {
      await database.destroy()
    })

    it('returns the owner’s photos in the order asked and leaves out anything else', async () => {
      const { items } = await getGallerySuggestionMedia({
        database,
        owner: { id: ownerId },
        mediaIds: [
          ids.second,
          ids.foreign,
          ids.out,
          ids.unposted,
          ids.gone,
          '999999',
          ids.first,
          ids.second
        ]
      })

      expect(items.map((item) => item.mediaId)).toEqual([ids.second, ids.first])
    })
  })
})
