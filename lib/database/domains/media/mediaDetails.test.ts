import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { EMPTY_MEDIA_DETAILS } from '@/lib/types/database/gallery'

describe('MediaDatabase details', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    let accountId: string

    beforeAll(async () => {
      await seedDatabase(database)
      const actor = await database.getActorFromId({ id: actors.primary.id })
      accountId = actor!.account!.id
    })

    afterAll(async () => {
      await database.destroy()
    })

    const createMedia = (
      name: string,
      details?: Parameters<typeof database.createMedia>[0]['details']
    ) =>
      database.createMedia({
        actorId: actors.primary.id,
        original: {
          path: `/test/details-${name}.jpg`,
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: { width: 100, height: 100 }
        },
        ...(details ? { details } : {})
      })

    it('gives a media created without details the empty details', async () => {
      const media = await createMedia('empty')

      const stored = await database.getMediaByIdForAccount({
        mediaId: media!.id,
        accountId
      })

      expect(stored?.details).toEqual(EMPTY_MEDIA_DETAILS)
    })

    it('round-trips every details field written at creation', async () => {
      const takenAt = Date.UTC(2024, 4, 6, 7, 8, 9)
      const media = await createMedia('full', {
        subjectName: 'Common Kingfisher',
        subjectScientificName: 'Alcedo atthis',
        subjectCategory: 'bird',
        takenAt,
        cameraGearId: 'camera-1',
        lensGearId: 'lens-1',
        exposure: {
          focalLengthMm: 400,
          aperture: 5.6,
          exposureTime: '1/2000',
          iso: 800
        },
        placeName: 'Lea Valley',
        placeLatitude: 51.55,
        placeLongitude: -0.02,
        placePrecision: 'area',
        inGallery: true
      })

      const stored = await database.getMediaByIdForAccount({
        mediaId: media!.id,
        accountId
      })

      expect(stored?.details).toEqual({
        subjectName: 'Common Kingfisher',
        subjectScientificName: 'Alcedo atthis',
        subjectCategory: 'bird',
        takenAt,
        cameraGearId: 'camera-1',
        lensGearId: 'lens-1',
        exposure: {
          focalLengthMm: 400,
          aperture: 5.6,
          exposureTime: '1/2000',
          iso: 800
        },
        placeName: 'Lea Valley',
        placeLatitude: 51.55,
        placeLongitude: -0.02,
        placePrecision: 'area',
        inGallery: true,
        subjectTaxonKey: null,
        subjectTaxonPath: null,
        subjectIucnCategory: null,
        // A species-like subject is queued for its lookup, so its place is
        // withheld from the public until the lookup clears it.
        subjectLookupStatus: 'pending',
        subjectLookupAt: expect.any(Number),
        subjectSuggestions: null,
        placeCountryCode: null,
        placeNameSource: 'owner',
        // A point is queued for its place lookup the same way, so the dialog
        // says it is being looked up rather than that it never was.
        placeLookupStatus: 'pending',
        placeLookupAt: expect.any(Number)
      })
    })

    it('updates only the details keys that are present', async () => {
      const media = await createMedia('partial', {
        subjectName: 'Grey Heron',
        placeName: 'Marsh',
        inGallery: true
      })

      const result = await database.updateMedia({
        mediaId: media!.id,
        accountId,
        details: { subjectScientificName: 'Ardea cinerea' }
      })

      expect(result?.media.details).toMatchObject({
        subjectName: 'Grey Heron',
        subjectScientificName: 'Ardea cinerea',
        placeName: 'Marsh',
        inGallery: true
      })
    })

    it('clears a details column when its key is null', async () => {
      const media = await createMedia('clear', {
        subjectName: 'Red Fox',
        exposure: { iso: 100 },
        takenAt: Date.UTC(2024, 0, 1),
        placeLatitude: 1,
        placeLongitude: 2
      })

      const result = await database.updateMedia({
        mediaId: media!.id,
        accountId,
        details: {
          subjectName: null,
          exposure: null,
          takenAt: null,
          placeLatitude: null,
          placeLongitude: null
        }
      })

      expect(result?.media.details).toMatchObject({
        subjectName: null,
        exposure: null,
        takenAt: null,
        placeLatitude: null,
        placeLongitude: null
      })
    })

    it('flips inGallery both ways', async () => {
      const media = await createMedia('gallery')

      const on = await database.updateMedia({
        mediaId: media!.id,
        accountId,
        details: { inGallery: true }
      })
      const off = await database.updateMedia({
        mediaId: media!.id,
        accountId,
        details: { inGallery: false }
      })

      expect(on?.media.details?.inGallery).toBeTrue()
      expect(off?.media.details?.inGallery).toBeFalse()
    })

    it('leaves the details alone on a description-only update', async () => {
      const media = await createMedia('description', {
        subjectName: 'Otter'
      })

      const result = await database.updateMedia({
        mediaId: media!.id,
        accountId,
        description: 'An otter'
      })

      expect(result?.media.details?.subjectName).toBe('Otter')
    })

    describe('lookup state', () => {
      const getDetails = async (mediaId: string) =>
        (await database.getMediaByIdForAccount({ mediaId, accountId }))!
          .details!

      const resolveSubject = async (mediaId: string, iucn: 'LC' | 'VU') => {
        const details = await getDetails(mediaId)
        return database.setMediaSubjectLookup({
          mediaId,
          expect: {
            subjectName: details.subjectName,
            subjectScientificName: details.subjectScientificName,
            subjectTaxonKey: details.subjectTaxonKey
          },
          patch: {
            subjectLookupStatus: 'resolved',
            subjectIucnCategory: iucn,
            subjectTaxonKey: '2481839',
            subjectTaxonPath: ['Animalia', 'Chordata', 'Aves']
          }
        })
      }

      it('round-trips every lookup column', async () => {
        const media = await createMedia('lookup-round-trip', {
          subjectName: 'Great Hornbill',
          subjectScientificName: 'Buceros bicornis',
          subjectCategory: 'bird',
          placeLatitude: 14.4389,
          placeLongitude: 101.3722,
          placePrecision: 'exact'
        })
        const lookupAt = Date.UTC(2026, 9, 8, 8, 0, 0)
        const suggestions = {
          model: 'vision-1',
          generatedAt: '2026-10-08T08:00:00.000Z',
          checkedAgainst: 'gbif' as const,
          candidates: [
            {
              name: 'Great Hornbill',
              scientificName: 'Buceros bicornis',
              category: 'bird' as const,
              confidence: 0.91,
              taxonKey: '2481839',
              rank: 'SPECIES',
              taxonPath: ['Animalia', 'Chordata', 'Aves']
            }
          ],
          group: 'bird' as const
        }

        expect(
          await database.setMediaSubjectLookup({
            mediaId: media!.id,
            expect: {
              subjectName: 'Great Hornbill',
              subjectScientificName: 'Buceros bicornis',
              subjectTaxonKey: null,
              subjectCategory: 'bird'
            },
            patch: {
              subjectLookupStatus: 'resolved',
              subjectIucnCategory: 'VU',
              subjectTaxonKey: '2481839',
              subjectTaxonPath: [
                'Animalia',
                'Chordata',
                'Aves',
                'Bucerotiformes',
                'Bucerotidae'
              ],
              subjectLookupAt: lookupAt
            }
          })
        ).toBeTrue()
        expect(
          await database.setMediaPlaceLookup({
            mediaId: media!.id,
            expect: { placeLatitude: 14.4389, placeLongitude: 101.3722 },
            patch: {
              placeLookupStatus: 'resolved',
              placeCountryCode: 'th',
              placeName: 'Pak Chong, Thailand'
            }
          })
        ).toBeTrue()
        expect(
          await database.setMediaSubjectSuggestions({
            mediaId: media!.id,
            suggestions
          })
        ).toBeTrue()

        expect(await getDetails(media!.id)).toMatchObject({
          subjectTaxonKey: '2481839',
          subjectTaxonPath: [
            'Animalia',
            'Chordata',
            'Aves',
            'Bucerotiformes',
            'Bucerotidae'
          ],
          subjectIucnCategory: 'VU',
          subjectLookupStatus: 'resolved',
          subjectLookupAt: lookupAt,
          subjectSuggestions: suggestions,
          placeName: 'Pak Chong, Thailand',
          placeNameSource: 'geocoder',
          placeCountryCode: 'TH',
          placeLookupStatus: 'resolved'
        })
      })

      it.each([
        [
          'a scientific name',
          { subjectScientificName: 'Ardea cinerea' },
          'pending'
        ],
        [
          'a bird by common name',
          { subjectName: 'Heron', subjectCategory: 'bird' as const },
          'pending'
        ],
        [
          'a landscape',
          { subjectName: 'Doi Suthep', subjectCategory: 'landscape' as const },
          null
        ],
        ['no subject', {}, null]
      ])(
        'queues %s for its lookup at creation: %s',
        async (_, subject, status) => {
          const media = await createMedia(
            `lookup-create-${String(status)}-${_}`,
            subject
          )
          expect(media!.details?.subjectLookupStatus).toBe(status)
          expect((await getDetails(media!.id)).subjectLookupStatus).toBe(status)
        }
      )

      it('resets the threat verdict when the subject changes', async () => {
        const media = await createMedia('lookup-reset-subject', {
          subjectName: 'Great Hornbill',
          subjectScientificName: 'Buceros bicornis',
          subjectCategory: 'bird'
        })
        expect(await resolveSubject(media!.id, 'LC')).toBeTrue()

        const result = await database.updateMedia({
          mediaId: media!.id,
          accountId,
          details: { subjectScientificName: 'Rhinoplax vigil' }
        })

        expect(result?.media.details).toMatchObject({
          subjectScientificName: 'Rhinoplax vigil',
          // The old key named the old species, so it goes too.
          subjectTaxonKey: null,
          subjectTaxonPath: null,
          subjectIucnCategory: null,
          subjectLookupStatus: 'pending',
          // When it became pending, for the dialog's stale-lookup Retry.
          subjectLookupAt: expect.any(Number)
        })
        expect(
          Math.abs(Date.now() - (result?.media.details?.subjectLookupAt ?? 0))
        ).toBeLessThan(60_000)
      })

      it('keeps a newly picked taxon key while resetting the verdict', async () => {
        const media = await createMedia('lookup-reset-key', {
          subjectName: 'Hornbill',
          subjectCategory: 'bird'
        })
        expect(await resolveSubject(media!.id, 'LC')).toBeTrue()

        const result = await database.updateMedia({
          mediaId: media!.id,
          accountId,
          details: {
            subjectName: 'Helmeted Hornbill',
            subjectScientificName: 'Rhinoplax vigil',
            subjectTaxonKey: '2481850'
          }
        })

        expect(result?.media.details).toMatchObject({
          subjectTaxonKey: '2481850',
          subjectIucnCategory: null,
          subjectLookupStatus: 'pending'
        })
      })

      it('clears the lookup status when the subject stops being species-like', async () => {
        const media = await createMedia('lookup-reset-landscape', {
          subjectName: 'Kingfisher',
          subjectCategory: 'bird'
        })
        expect(await resolveSubject(media!.id, 'LC')).toBeTrue()

        const result = await database.updateMedia({
          mediaId: media!.id,
          accountId,
          details: {
            subjectName: 'Sunset',
            subjectCategory: 'landscape',
            subjectTaxonKey: null
          }
        })

        expect(result?.media.details).toMatchObject({
          subjectLookupStatus: null,
          subjectIucnCategory: null
        })
      })

      it('keeps a finished lookup when the same subject is saved again', async () => {
        const media = await createMedia('lookup-same-subject', {
          subjectName: 'Great Hornbill',
          subjectScientificName: 'Buceros bicornis',
          subjectCategory: 'bird'
        })
        expect(await resolveSubject(media!.id, 'VU')).toBeTrue()

        const result = await database.updateMedia({
          mediaId: media!.id,
          accountId,
          details: {
            subjectName: 'Great Hornbill',
            subjectScientificName: 'Buceros bicornis',
            subjectCategory: 'bird',
            subjectTaxonKey: '2481839',
            inGallery: true
          }
        })

        expect(result?.media.details).toMatchObject({
          subjectIucnCategory: 'VU',
          subjectLookupStatus: 'resolved'
        })
      })

      it('leaves the threat verdict alone on an edit that names no subject field', async () => {
        const media = await createMedia('lookup-unrelated', {
          subjectScientificName: 'Buceros bicornis'
        })
        expect(await resolveSubject(media!.id, 'VU')).toBeTrue()

        const result = await database.updateMedia({
          mediaId: media!.id,
          accountId,
          details: { placePrecision: 'exact', inGallery: true }
        })

        expect(result?.media.details?.subjectIucnCategory).toBe('VU')
      })

      it('resets the country and place status when the coordinates change', async () => {
        const media = await createMedia('lookup-reset-place', {
          placeLatitude: 14.4,
          placeLongitude: 101.4
        })
        expect(
          await database.setMediaPlaceLookup({
            mediaId: media!.id,
            expect: { placeLatitude: 14.4, placeLongitude: 101.4 },
            patch: {
              placeLookupStatus: 'resolved',
              placeCountryCode: 'TH',
              placeName: 'Pak Chong, Thailand'
            }
          })
        ).toBeTrue()

        const result = await database.updateMedia({
          mediaId: media!.id,
          accountId,
          details: { placeLatitude: 18.79, placeLongitude: 98.98 }
        })

        expect(result?.media.details).toMatchObject({
          placeLatitude: 18.79,
          placeLongitude: 98.98,
          placeCountryCode: null,
          // The new point's lookup is queued right after this write.
          placeLookupStatus: 'pending',
          placeLookupAt: expect.any(Number),
          // The geocoded name described the old point.
          placeName: null,
          placeNameSource: null
        })
      })

      it('records when a place lookup became pending, and when it ran', async () => {
        const before = Date.now()
        const media = await createMedia('lookup-place-at', {
          placeLatitude: 14.4,
          placeLongitude: 101.4
        })
        const pending = await getDetails(media!.id)
        expect(pending.placeLookupStatus).toBe('pending')
        expect(pending.placeLookupAt).toBeGreaterThanOrEqual(before - 1000)

        await database.setMediaPlaceLookup({
          mediaId: media!.id,
          expect: { placeLatitude: 14.4, placeLongitude: 101.4 },
          patch: { placeLookupStatus: 'failed', placeLookupAt: before + 5000 }
        })
        expect(await getDetails(media!.id)).toMatchObject({
          placeLookupStatus: 'failed',
          placeLookupAt: before + 5000
        })
      })

      it('clears the place status when the point is cleared', async () => {
        const media = await createMedia('lookup-place-cleared', {
          placeLatitude: 14.4,
          placeLongitude: 101.4
        })

        const result = await database.updateMedia({
          mediaId: media!.id,
          accountId,
          details: { placeLatitude: null, placeLongitude: null }
        })

        expect(result?.media.details).toMatchObject({
          placeLookupStatus: null,
          placeLookupAt: null
        })
      })

      it('keeps a finished place lookup when the same point is re-sent', async () => {
        const media = await createMedia('lookup-place-same', {
          placeLatitude: 14.4,
          placeLongitude: 101.4
        })
        await database.setMediaPlaceLookup({
          mediaId: media!.id,
          expect: { placeLatitude: 14.4, placeLongitude: 101.4 },
          patch: { placeLookupStatus: 'resolved', placeCountryCode: 'TH' }
        })

        const result = await database.updateMedia({
          mediaId: media!.id,
          accountId,
          details: { placeLatitude: 14.4, placeLongitude: 101.4 }
        })

        expect(result?.media.details).toMatchObject({
          placeLookupStatus: 'resolved',
          placeCountryCode: 'TH'
        })
      })

      it('keeps the owner name and the country when only the name changes', async () => {
        const media = await createMedia('lookup-owner-name', {
          placeLatitude: 14.4,
          placeLongitude: 101.4
        })
        await database.setMediaPlaceLookup({
          mediaId: media!.id,
          expect: { placeLatitude: 14.4, placeLongitude: 101.4 },
          patch: {
            placeLookupStatus: 'resolved',
            placeCountryCode: 'TH',
            placeName: 'Pak Chong, Thailand'
          }
        })

        const renamed = await database.updateMedia({
          mediaId: media!.id,
          accountId,
          details: { placeName: 'Khao Yai' }
        })
        expect(renamed?.media.details).toMatchObject({
          placeName: 'Khao Yai',
          placeNameSource: 'owner',
          placeCountryCode: 'TH',
          placeLookupStatus: 'resolved'
        })

        // Moving the point keeps a name the owner typed.
        const moved = await database.updateMedia({
          mediaId: media!.id,
          accountId,
          details: { placeLatitude: 14.5, placeLongitude: 101.5 }
        })
        expect(moved?.media.details).toMatchObject({
          placeName: 'Khao Yai',
          placeNameSource: 'owner',
          placeCountryCode: null
        })
      })

      it('overwrites a place name only when it is missing or the geocoder wrote it', async () => {
        const media = await createMedia('lookup-geocoder-name', {
          placeLatitude: 1,
          placeLongitude: 2
        })
        const geocode = (placeName: string) =>
          database.setMediaPlaceLookup({
            mediaId: media!.id,
            expect: { placeLatitude: 1, placeLongitude: 2 },
            patch: {
              placeLookupStatus: 'resolved',
              placeCountryCode: 'GB',
              placeName
            }
          })

        expect(await geocode('First, United Kingdom')).toBeTrue()
        expect((await getDetails(media!.id)).placeName).toBe(
          'First, United Kingdom'
        )
        // The geocoder may refresh its own name.
        expect(await geocode('Second, United Kingdom')).toBeTrue()
        expect((await getDetails(media!.id)).placeName).toBe(
          'Second, United Kingdom'
        )

        await database.updateMedia({
          mediaId: media!.id,
          accountId,
          details: { placeName: 'My garden' }
        })
        // But never the owner's; the country still lands.
        expect(await geocode('Third, United Kingdom')).toBeTrue()
        expect(await getDetails(media!.id)).toMatchObject({
          placeName: 'My garden',
          placeNameSource: 'owner',
          placeCountryCode: 'GB'
        })
      })

      it('loses a subject lookup write when the subject changed after the read', async () => {
        const media = await createMedia('lookup-cas-subject', {
          subjectName: 'Hornbill',
          subjectCategory: 'bird'
        })
        const read = await getDetails(media!.id)

        // The owner edits while the lookup is in flight.
        await database.updateMedia({
          mediaId: media!.id,
          accountId,
          details: { subjectScientificName: 'Rhinoplax vigil' }
        })

        expect(
          await database.setMediaSubjectLookup({
            mediaId: media!.id,
            expect: {
              subjectName: read.subjectName,
              subjectScientificName: read.subjectScientificName,
              subjectTaxonKey: read.subjectTaxonKey
            },
            patch: {
              subjectLookupStatus: 'resolved',
              subjectIucnCategory: 'LC'
            }
          })
        ).toBeFalse()
        expect(await getDetails(media!.id)).toMatchObject({
          subjectLookupStatus: 'pending',
          subjectIucnCategory: null
        })
      })

      it('compares a null expectation as IS NULL', async () => {
        const media = await createMedia('lookup-cas-null', {
          subjectName: 'Hornbill',
          subjectCategory: 'bird'
        })

        // Expecting a scientific name the row does not have misses...
        expect(
          await database.setMediaSubjectLookup({
            mediaId: media!.id,
            expect: {
              subjectName: 'Hornbill',
              subjectScientificName: 'Buceros bicornis',
              subjectTaxonKey: null
            },
            patch: { subjectLookupStatus: 'no-match' }
          })
        ).toBeFalse()
        // ...and expecting none matches.
        expect(
          await database.setMediaSubjectLookup({
            mediaId: media!.id,
            expect: {
              subjectName: 'Hornbill',
              subjectScientificName: null,
              subjectTaxonKey: null
            },
            patch: { subjectLookupStatus: 'no-match' }
          })
        ).toBeTrue()
        expect((await getDetails(media!.id)).subjectLookupStatus).toBe(
          'no-match'
        )
      })

      it('honours the optional category expectation', async () => {
        const media = await createMedia('lookup-cas-category', {
          subjectName: 'Hornbill',
          subjectCategory: 'bird'
        })
        expect(
          await database.setMediaSubjectLookup({
            mediaId: media!.id,
            expect: {
              subjectName: 'Hornbill',
              subjectScientificName: null,
              subjectTaxonKey: null,
              subjectCategory: 'mammal'
            },
            patch: { subjectLookupStatus: 'failed' }
          })
        ).toBeFalse()
      })

      it('loses a place lookup write when the point moved after the read', async () => {
        const media = await createMedia('lookup-cas-place', {
          placeLatitude: 14.4,
          placeLongitude: 101.4
        })
        await database.updateMedia({
          mediaId: media!.id,
          accountId,
          details: { placeLatitude: 18.79, placeLongitude: 98.98 }
        })

        expect(
          await database.setMediaPlaceLookup({
            mediaId: media!.id,
            expect: { placeLatitude: 14.4, placeLongitude: 101.4 },
            patch: {
              placeLookupStatus: 'resolved',
              placeCountryCode: 'TH',
              placeName: 'Pak Chong, Thailand'
            }
          })
        ).toBeFalse()
        expect(await getDetails(media!.id)).toMatchObject({
          placeCountryCode: null,
          placeName: null,
          placeLookupStatus: 'pending'
        })
      })

      it('matches null coordinates as IS NULL', async () => {
        const media = await createMedia('lookup-cas-no-point')
        expect(
          await database.setMediaPlaceLookup({
            mediaId: media!.id,
            expect: { placeLatitude: null, placeLongitude: null },
            patch: { placeLookupStatus: 'disabled' }
          })
        ).toBeTrue()
        expect((await getDetails(media!.id)).placeLookupStatus).toBe('disabled')
      })

      it('refuses an unknown status or IUCN category', async () => {
        const media = await createMedia('lookup-invalid')
        await expect(
          database.setMediaSubjectLookup({
            mediaId: media!.id,
            expect: {
              subjectName: null,
              subjectScientificName: null,
              subjectTaxonKey: null
            },
            patch: {
              subjectLookupStatus: 'resolved',
              subjectIucnCategory: 'XX' as never
            }
          })
        ).rejects.toThrow('Unknown IUCN category')
        await expect(
          database.setMediaPlaceLookup({
            mediaId: media!.id,
            expect: { placeLatitude: null, placeLongitude: null },
            patch: { placeLookupStatus: 'done' as never }
          })
        ).rejects.toThrow('Unknown place lookup status')
      })

      it('refuses suggestions over the size cap and clears them with null', async () => {
        const media = await createMedia('lookup-suggestions')
        const big = {
          model: 'vision-1',
          generatedAt: '2026-10-08T08:00:00.000Z',
          checkedAgainst: null,
          candidates: [
            {
              name: 'x'.repeat(17 * 1024),
              scientificName: null,
              category: 'bird' as const,
              confidence: 0.5,
              taxonKey: null,
              rank: null,
              taxonPath: []
            }
          ],
          group: null
        }
        expect(
          await database.setMediaSubjectSuggestions({
            mediaId: media!.id,
            suggestions: big
          })
        ).toBeFalse()
        expect(
          await database.setMediaSubjectSuggestions({
            mediaId: media!.id,
            suggestions: { ...big, candidates: [] }
          })
        ).toBeTrue()
        expect((await getDetails(media!.id)).subjectSuggestions).not.toBeNull()
        expect(
          await database.setMediaSubjectSuggestions({
            mediaId: media!.id,
            suggestions: null
          })
        ).toBeTrue()
        expect((await getDetails(media!.id)).subjectSuggestions).toBeNull()
      })

      it.each(['abc', '', '2147483648'])(
        'answers false for the media id %j',
        async (mediaId) => {
          expect(
            await database.setMediaSubjectLookup({
              mediaId,
              expect: {
                subjectName: null,
                subjectScientificName: null,
                subjectTaxonKey: null
              },
              patch: { subjectLookupStatus: 'failed' }
            })
          ).toBeFalse()
          expect(
            await database.setMediaPlaceLookup({
              mediaId,
              expect: { placeLatitude: null, placeLongitude: null },
              patch: { placeLookupStatus: 'failed' }
            })
          ).toBeFalse()
          expect(
            await database.setMediaSubjectSuggestions({
              mediaId,
              suggestions: null
            })
          ).toBeFalse()
        }
      )
    })

    describe('getMediaWithAttachedStatusIds', () => {
      it('returns the media with every status it is attached to', async () => {
        const media = await createMedia('attached')
        const statuses = await database.getActorStatuses({
          actorId: actors.primary.id,
          limit: 2
        })
        expect(statuses.length).toBeGreaterThanOrEqual(2)
        for (const status of statuses) {
          await database.createAttachment({
            actorId: actors.primary.id,
            statusId: status.id,
            mediaType: 'image/jpeg',
            url: media!.original.path,
            mediaId: media!.id
          })
        }

        const found = await database.getMediaWithAttachedStatusIds({
          mediaId: media!.id
        })

        expect(found?.media.id).toBe(media!.id)
        expect(found?.statusIds.toSorted()).toEqual(
          statuses.map((status) => status.id).toSorted()
        )
      })

      it('ignores an attachment written by an actor that does not own the media', async () => {
        const media = await createMedia('foreign-attachment')
        const [status] = await database.getActorStatuses({
          actorId: actors.replyAuthor.id,
          limit: 1
        })
        expect(status).toBeDefined()
        await database.createAttachment({
          actorId: actors.replyAuthor.id,
          statusId: status.id,
          mediaType: 'image/jpeg',
          url: 'x',
          mediaId: media!.id
        })

        expect(
          await database.getMediaWithAttachedStatusIds({ mediaId: media!.id })
        ).toMatchObject({ statusIds: [] })
      })

      it('returns no statuses for an unattached media', async () => {
        const media = await createMedia('unattached')

        expect(
          await database.getMediaWithAttachedStatusIds({ mediaId: media!.id })
        ).toMatchObject({ statusIds: [] })
      })

      it.each(['999999999', 'abc', '', '1e3', '2147483648'])(
        'returns null for %j',
        async (mediaId) => {
          expect(
            await database.getMediaWithAttachedStatusIds({ mediaId })
          ).toBeNull()
        }
      )
    })
  })
})
