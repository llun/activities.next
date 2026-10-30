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
  PUBLIC_GALLERY_AUDIENCE
} from '@/lib/services/gallery/galleryAudience'
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

    describe('the times a visitor is shown', () => {
      const pause = () => new Promise((resolve) => setTimeout(resolve, 15))

      // Two public albums of one visible photo each, `older` made first.
      const makeAlbum = async (title: string, name: string) => {
        const created = await database.createGalleryAlbumWithinLimit({
          actorId: matrix.ownerId,
          title,
          visibility: 'public',
          limit: 50,
          mediaIds: [matrix.media[name]],
          itemLimit: 2000
        })
        if (created.status !== 'created') throw new Error('not created')
        return created.album.id
      }

      const snapshot = async (who: Actor | null, ids: string[]) => {
        const list = await getGalleryAlbumList({
          database,
          owner,
          audience: await audienceOf(who)
        })
        const mine = list.albums.filter((album) => ids.includes(album.id))
        return {
          order: mine.map((album) => album.id),
          times: mine.map((album) => [album.createdAt, album.updatedAt])
        }
      }

      it('never moves for a photo the visitor cannot see, in the card or the list order', async () => {
        const older = await makeAlbum('Older', 'public')
        await pause()
        const newer = await makeAlbum('Newer', 'unlisted')
        const ids = [older, newer]
        const blind: Array<[string, Actor | null]> = [
          ['logged out', null],
          ['a stranger', matrix.viewers.stranger],
          ['a blocked account', matrix.viewers.blocked]
        ]
        const follower: [string, Actor | null] = [
          'a follower',
          matrix.viewers.follower
        ]
        const read = async ([, who]: [string, Actor | null]) => ({
          ...(await snapshot(who, ids)),
          card: (({ createdAt, updatedAt }) => [createdAt, updatedAt])(
            (await view(await audienceOf(who), older))!.album
          )
        })
        const add = async (name: string) => {
          await pause()
          await database.addGalleryAlbumItems({
            albumId: older,
            actorId: matrix.ownerId,
            mediaIds: [matrix.media[name]],
            limit: 2000
          })
        }
        try {
          const before = await Promise.all([...blind, follower].map(read))
          // Newest first for a visitor: the album made last.
          expect(before[0].order).toEqual([newer, older])
          const ownerBefore = (await snapshot(owner, ids)).times

          // A direct-message photo: nobody but the owner can open it.
          await add('direct')
          expect(await Promise.all([...blind, follower].map(read))).toEqual(
            before
          )
          // The owner's own stored time does move.
          expect((await snapshot(owner, ids)).times).not.toEqual(ownerBefore)

          // A followers-only photo: everyone but a follower is blind to it.
          await add('followers')
          expect(await Promise.all(blind.map(read))).toEqual(before.slice(0, 3))

          // Taking both out changes nothing either.
          await pause()
          await database.removeGalleryAlbumItems({
            albumId: older,
            actorId: matrix.ownerId,
            mediaIds: [matrix.media.direct, matrix.media.followers]
          })
          expect(await Promise.all([...blind, follower].map(read))).toEqual(
            before
          )
        } finally {
          for (const id of ids) {
            await database.deleteGalleryAlbum({ id, actorId: matrix.ownerId })
          }
        }
      })

      it('is built from when the visible photos joined the album', async () => {
        const id = await makeAlbum('Timed', 'public')
        try {
          await pause()
          await database.addGalleryAlbumItems({
            albumId: id,
            actorId: matrix.ownerId,
            mediaIds: [matrix.media.unlisted],
            limit: 2000
          })
          const items = await database.getGalleryAlbumIndex({
            albumId: id,
            actorId: matrix.ownerId,
            audience: PUBLIC_GALLERY_AUDIENCE
          })
          const added = items.map((row) => row.addedAt)
          const card = (await view(PUBLIC_GALLERY_AUDIENCE, id))!.album

          expect(card.createdAt).toBe(Math.min(...added))
          expect(card.updatedAt).toBe(Math.max(...added))
          expect(card.updatedAt).toBeGreaterThan(card.createdAt)
        } finally {
          await database.deleteGalleryAlbum({ id, actorId: matrix.ownerId })
        }
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

        expect(share!.album.itemCount).toBe(3)
        expect(share!.facts).toEqual(loggedOut!.facts)
        expect(share!.album.cover?.mediaId).toBe(
          loggedOut!.album.cover?.mediaId
        )
        expect(share!.album.cover?.mediaId).not.toBe(matrix.media.followers)
        expect([
          matrix.media.public,
          matrix.media.unlisted,
          matrix.media.hidden
        ]).toContain(share!.album.cover?.mediaId)
        expect(share!.facts.lastAt).toBe(
          new Date(Date.UTC(2026, 5, 10, 12)).toISOString()
        )
        // Nothing of the photos a logged-out visitor cannot open.
        const text = JSON.stringify(share)
        for (const name of ['followers', 'direct', 'deleted']) {
          expect(text).not.toContain(`"mediaId":"${matrix.media[name]}"`)
          expect(text).not.toContain(`matrix-${name}.jpg`)
        }
        expect(text).toContain(`"mediaId":"${matrix.media.hidden}"`)
        expect(text).toContain('matrix-hidden.jpg')
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
    })
  })
})
