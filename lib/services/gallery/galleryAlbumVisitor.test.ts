import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import {
  GalleryAlbumMatrix,
  seedGalleryAlbumMatrix
} from '@/lib/services/gallery/galleryAlbumMatrixFixtures'
import {
  computeGalleryAlbumFacts,
  getGalleryAlbumList,
  getGalleryAlbumShare,
  getGalleryAlbumView
} from '@/lib/services/gallery/galleryAlbumQueries'
import {
  GalleryAudience,
  OWNER_GALLERY_AUDIENCE,
  PUBLIC_GALLERY_AUDIENCE
} from '@/lib/services/gallery/galleryAudience'
import { getPublicPlace } from '@/lib/services/gallery/publicMediaDetails'
import { resolveGalleryAudience } from '@/lib/services/gallery/resolveGalleryAccount'
import { Actor } from '@/lib/types/domain/actor'

// The visitor matrix of the album page and API: who sees which photo of an
// album, and what they are told about the ones they cannot see. Every viewer
// goes through `resolveGalleryAudience`, the same step the route and the page
// take, so the audiences here are the real ones: a follower's, a signed-in
// stranger's, a blocked account's, logged out, and the owner.
describe('album visitor matrix', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    let matrix: GalleryAlbumMatrix
    let owner: Actor

    beforeAll(async () => {
      matrix = await seedGalleryAlbumMatrix(database)
      owner = (await database.getActorFromId({ id: matrix.ownerId }))!
    })

    afterAll(async () => {
      await database.destroy()
    })

    const audienceOf = (currentActor: Actor | null) =>
      resolveGalleryAudience({ database, owner, currentActor })

    // [name, who, the photos of `mixed` they can open, in taken-at order].
    type Who = 'owner' | 'follower' | 'stranger' | 'blocked' | 'loggedOut'
    const actorFor = (who: Who): Actor | null =>
      who === 'owner' ? owner : who === 'loggedOut' ? null : matrix.viewers[who]

    const viewerCases: Array<
      [string, Who, string[], { first: number; last: number }]
    > = [
      [
        'the owner',
        'owner',
        // The deleted post and the photo not in the gallery are gone for
        // everyone, the owner included.
        ['public', 'unlisted', 'followers', 'direct'],
        { first: Date.UTC(2026, 0, 10, 12), last: Date.UTC(2026, 3, 10, 12) }
      ],
      [
        'a follower',
        'follower',
        ['public', 'unlisted', 'followers'],
        { first: Date.UTC(2026, 0, 10, 12), last: Date.UTC(2026, 2, 10, 12) }
      ],
      [
        'a signed-in stranger',
        'stranger',
        ['public', 'unlisted'],
        { first: Date.UTC(2026, 0, 10, 12), last: Date.UTC(2026, 1, 10, 12) }
      ],
      [
        'a blocked account',
        'blocked',
        ['public', 'unlisted'],
        { first: Date.UTC(2026, 0, 10, 12), last: Date.UTC(2026, 1, 10, 12) }
      ],
      [
        'a logged-out visitor',
        'loggedOut',
        ['public', 'unlisted'],
        { first: Date.UTC(2026, 0, 10, 12), last: Date.UTC(2026, 1, 10, 12) }
      ]
    ]

    const view = async (
      audience: GalleryAudience,
      albumId: string,
      extra: { limit?: number; maxId?: string } = {}
    ) =>
      getGalleryAlbumView({
        database,
        owner,
        audience,
        albumId,
        limit: 50,
        ...extra
      })

    describe('the photos of a mixed album', () => {
      it.each(viewerCases)(
        'shows %s exactly the posts they may read',
        async (_name, who, visible, range) => {
          const result = await view(
            await audienceOf(actorFor(who)),
            matrix.albums.mixed
          )
          const expected = visible.map((name) => matrix.media[name]).sort()

          expect(result!.items.map((item) => item.mediaId).sort()).toEqual(
            expected
          )
          // The count, the facts and the card agree with the items.
          expect(result!.facts.photoCount).toBe(visible.length)
          // Counted over what this viewer can open, the owner included: the
          // deleted post and the photo not in the gallery are in no count.
          expect(result!.album.itemCount).toBe(visible.length)
          expect(result!.facts.firstAt).toBe(
            new Date(range.first).toISOString()
          )
          expect(result!.facts.lastAt).toBe(new Date(range.last).toISOString())
          expect(result!.album.firstAt).toBe(result!.facts.firstAt)
          expect(result!.album.lastAt).toBe(result!.facts.lastAt)
        }
      )

      it.each(viewerCases)(
        'gives %s a cover they can open, never the followers-only one chosen for it',
        async (_name, who, visible) => {
          const result = await view(
            await audienceOf(actorFor(who)),
            matrix.albums.mixed
          )
          const coverId = result!.album.cover?.mediaId

          expect(coverId).toBeDefined()
          expect(visible.map((name) => matrix.media[name])).toContain(coverId)
          // The owner picked the followers-only photo; only those who may see
          // it get it.
          if (visible.includes('followers')) {
            expect(coverId).toBe(matrix.media.followers)
          } else {
            expect(coverId).not.toBe(matrix.media.followers)
          }
          // And nothing in the collage is a photo they cannot open.
          for (const preview of result!.album.previews) {
            expect(visible.map((name) => matrix.media[name])).toContain(
              preview.mediaId
            )
          }
        }
      )

      it('keeps owner-only fields out of every visitor response', async () => {
        for (const who of [
          matrix.viewers.follower,
          matrix.viewers.stranger,
          matrix.viewers.blocked,
          null
        ]) {
          const result = await view(await audienceOf(who), matrix.albums.mixed)
          expect(result!.album.coverMediaId).toBeNull()
          expect(result!.album.hiddenPlaceCount).toBe(0)
          expect(JSON.stringify(result)).not.toMatch(
            /subjectIucnCategory|subjectLookupStatus|hiddenPlaceCount":[1-9]/
          )
        }
        // The owner does get them.
        const owned = await view(OWNER_GALLERY_AUDIENCE, matrix.albums.mixed)
        expect(owned!.album.coverMediaId).toBe(matrix.media.followers)
      })

      it('pages a visitor with a keyset that never repeats or skips a photo', async () => {
        const audience = await audienceOf(matrix.viewers.follower)
        const seen: string[] = []
        let maxId: string | undefined
        for (let pages = 0; pages < 5; pages++) {
          const page = await view(audience, matrix.albums.mixed, {
            limit: 1,
            maxId
          })
          seen.push(...page!.items.map((item) => item.mediaId))
          if (!page!.nextMaxId) break
          maxId = page!.nextMaxId
        }

        expect(seen).toHaveLength(3)
        expect(new Set(seen).size).toBe(3)
        expect(seen.sort()).toEqual(
          ['public', 'unlisted', 'followers']
            .map((name) => matrix.media[name])
            .sort()
        )
      })
    })

    describe('which albums a visitor can open', () => {
      // [album, who, whether the album is there for them]
      const albumCases: Array<
        [string, keyof GalleryAlbumMatrix['albums'], boolean[]]
      > = [
        // Order: owner, follower, stranger, blocked, logged out.
        ['a mixed album', 'mixed', [true, true, true, true, true]],
        [
          'an album holding only a followers-only photo',
          'followersOnly',
          [true, true, false, false, false]
        ],
        [
          'an album holding only a direct-message photo',
          'directOnly',
          [true, false, false, false, false]
        ],
        [
          'an album whose only photos are deleted or not in the gallery',
          'goneOnly',
          [true, false, false, false, false]
        ],
        ['a private album', 'secret', [true, false, false, false, false]],
        ['an empty album', 'empty', [true, false, false, false, false]]
      ]

      it.each(albumCases)(
        'answers for %s: owner, follower, stranger, blocked, logged out',
        async (_name, key, expected) => {
          const whos: Who[] = [
            'owner',
            'follower',
            'stranger',
            'blocked',
            'loggedOut'
          ]
          const actual = await Promise.all(
            whos.map(async (who) =>
              Boolean(
                await view(await audienceOf(actorFor(who)), matrix.albums[key])
              )
            )
          )

          expect(actual).toEqual(expected)
        }
      )

      it('lists exactly the albums a visitor can open, with their own counts', async () => {
        const listed = async (who: Actor | null) => {
          const response = await getGalleryAlbumList({
            database,
            owner,
            audience: await audienceOf(who)
          })
          return {
            ids: response.albums.map((album) => album.id).sort(),
            counts: Object.fromEntries(
              response.albums.map((album) => [album.id, album.itemCount])
            ),
            photoCount: response.photoCount
          }
        }
        const { albums } = matrix

        const everyone = [albums.mixed, albums.places].sort()
        const loggedOut = await listed(null)
        expect(loggedOut.ids).toEqual(everyone)
        expect(loggedOut.counts[albums.mixed]).toBe(2)
        for (const who of [matrix.viewers.stranger, matrix.viewers.blocked]) {
          expect((await listed(who)).ids).toEqual(everyone)
        }

        const follower = await listed(matrix.viewers.follower)
        expect(follower.ids).toEqual(
          [albums.mixed, albums.followersOnly, albums.places].sort()
        )
        expect(follower.counts[albums.mixed]).toBe(3)
        expect(follower.counts[albums.followersOnly]).toBe(1)

        const mine = await listed(owner)
        expect(mine.ids).toEqual(Object.values(albums).sort())
        // The photo total never counts a photo twice, or one nobody can open.
        expect(loggedOut.photoCount).toBe(2 + 7)
        expect(follower.photoCount).toBe(3 + 7)
      })
    })

    describe('the Open Graph share', () => {
      it('is the logged-out album, whoever is looking, and matches what a logged-out page shows', async () => {
        const share = await getGalleryAlbumShare({
          database,
          owner,
          albumId: matrix.albums.mixed
        })
        const loggedOut = await view(
          PUBLIC_GALLERY_AUDIENCE,
          matrix.albums.mixed
        )

        expect(share!.album.itemCount).toBe(2)
        expect(share!.facts).toEqual(loggedOut!.facts)
        expect(share!.album.cover?.mediaId).toBe(
          loggedOut!.album.cover?.mediaId
        )
        expect(share!.album.cover?.mediaId).not.toBe(matrix.media.followers)
        expect([matrix.media.public, matrix.media.unlisted]).toContain(
          share!.album.cover?.mediaId
        )
        expect(share!.facts.lastAt).toBe(
          new Date(Date.UTC(2026, 1, 10, 12)).toISOString()
        )
        // Nothing of the photos a logged-out visitor cannot open.
        const text = JSON.stringify(share)
        for (const name of ['followers', 'direct', 'deleted', 'hidden']) {
          expect(text).not.toContain(`"mediaId":"${matrix.media[name]}"`)
          expect(text).not.toContain(`matrix-${name}.jpg`)
        }
      })

      it.each([
        ['a private album', 'secret'],
        ['an empty album', 'empty'],
        ['a followers-only album', 'followersOnly'],
        ['a direct-message album', 'directOnly'],
        ['an album of deleted posts', 'goneOnly']
      ] as const)('is null for %s', async (_name, key) => {
        expect(
          await getGalleryAlbumShare({
            database,
            owner,
            albumId: matrix.albums[key]
          })
        ).toBeNull()
      })

      it('is null for an id that does not exist, and for another account’s album', async () => {
        expect(
          await getGalleryAlbumShare({ database, owner, albumId: 'nope' })
        ).toBeNull()
        expect(
          await getGalleryAlbumShare({
            database,
            owner: { id: matrix.viewers.stranger.id },
            albumId: matrix.albums.mixed
          })
        ).toBeNull()
        expect(await view(PUBLIC_GALLERY_AUDIENCE, 'nope')).toBeNull()
      })
    })

    describe('places', () => {
      const publicRows = () =>
        database.getGalleryAlbumIndex({
          albumId: matrix.albums.places,
          actorId: matrix.ownerId,
          audience: PUBLIC_GALLERY_AUDIENCE
        })

      it.each([
        ['a logged-out visitor', () => audienceOf(null)],
        ['a stranger', () => audienceOf(matrix.viewers.stranger)],
        ['a follower', () => audienceOf(matrix.viewers.follower)],
        ['a blocked account', () => audienceOf(matrix.viewers.blocked)]
      ])('gives %s exactly getPublicPlace, photo by photo', async (_, make) => {
        const result = await view(await make(), matrix.albums.places)
        const settings = await database.getGallerySettings({
          actorId: matrix.ownerId
        })
        const rows = await publicRows()

        expect(result!.items).toHaveLength(7)
        expect(rows).toHaveLength(7)
        for (const row of rows) {
          const item = result!.items.find(
            (candidate) => candidate.mediaId === row.id
          )
          expect(item?.place ?? null).toEqual(getPublicPlace(row, settings))
        }
      })

      it('spells out each rule', async () => {
        const result = await view(PUBLIC_GALLERY_AUDIENCE, matrix.albums.places)
        const placeOf = (name: string) =>
          result!.items.find((item) => item.mediaId === matrix.media[name])
            ?.place ?? null

        // A species that is not threatened, at exact precision: shown.
        expect(placeOf('place-exact')).toMatchObject({
          name: 'Satara',
          latitude: -24.4,
          longitude: 31.7
        })
        // Area precision snaps the point to a grid, so the stored point is not
        // what comes out.
        const area = placeOf('place-area')
        expect(area).not.toBeNull()
        expect(area!.latitude).not.toBe(52.123456)
        expect(area!.longitude).not.toBe(5.654321)
        // Country precision: the country, never the geocoded name.
        expect(placeOf('place-country')).toMatchObject({
          name: 'Thailand',
          countryCode: 'TH'
        })
        // Hidden precision, a threatened species, a failed conservation check
        // and a hidden location all say nothing.
        for (const name of [
          'place-hidden-precision',
          'place-threatened',
          'place-failed',
          'place-zone'
        ]) {
          expect(placeOf(name)).toBeNull()
        }
      })

      it('counts only the places getPublicPlace shows, in the facts and in the share', async () => {
        const settings = await database.getGallerySettings({
          actorId: matrix.ownerId
        })
        const expected = computeGalleryAlbumFacts(await publicRows(), settings)
        const result = await view(PUBLIC_GALLERY_AUDIENCE, matrix.albums.places)
        const share = await getGalleryAlbumShare({
          database,
          owner,
          albumId: matrix.albums.places
        })

        // Satara, the snapped heath, and Thailand.
        expect(expected.placeCount).toBe(3)
        expect(expected.countryCodes).toEqual(['TH', 'ZA'])
        expect(result!.facts).toEqual(expected)
        expect(share!.facts).toEqual(expected)
        // A withheld place adds no country either.
        expect(expected.countryCodes).not.toContain('IN')
        expect(expected.countryName).toBeNull()
      })

      it('never tells a visitor a place was withheld, though the owner is told', async () => {
        const visitor = await view(
          await audienceOf(matrix.viewers.follower),
          matrix.albums.places
        )
        expect(visitor!.album.hiddenPlaceCount).toBe(0)

        // The threatened species and the failed check, two places.
        const owned = await view(OWNER_GALLERY_AUDIENCE, matrix.albums.places)
        expect(owned!.album.hiddenPlaceCount).toBe(2)
      })

      it('shows the owner every stored place', async () => {
        const owned = await view(OWNER_GALLERY_AUDIENCE, matrix.albums.places)
        const placeOf = (name: string) =>
          owned!.items.find((item) => item.mediaId === matrix.media[name])
            ?.place ?? null

        expect(placeOf('place-threatened')).toMatchObject({ name: 'Hemis' })
        expect(placeOf('place-zone')).toMatchObject({ name: 'Nest site' })
      })
    })
  })
})
