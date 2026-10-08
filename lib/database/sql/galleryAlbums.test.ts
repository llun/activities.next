import type { GalleryAlbumCursor } from '@/lib/database/sql/galleryAlbums'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import {
  GalleryAudience,
  OWNER_GALLERY_AUDIENCE,
  PUBLIC_GALLERY_AUDIENCE
} from '@/lib/services/gallery/galleryAudience'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { MediaDetailsRecord } from '@/lib/types/database/gallery'
import {
  GalleryAlbumSort,
  MAX_GALLERY_ALBUMS_PER_ACTOR,
  MAX_GALLERY_ALBUM_ITEMS
} from '@/lib/types/database/galleryAlbums'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// Every query chunks its `whereIn` lists by `getWhereInBatchSize`. Capping it
// at 2 makes this small fixture span several chunks, so the batched reads and
// writes are exercised across chunk boundaries.
vi.mock('@/lib/database/sql/utils/knex', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/database/sql/utils/knex')>()
  return {
    ...original,
    getWhereInBatchSize: (
      ...args: Parameters<typeof original.getWhereInBatchSize>
    ) => Math.min(original.getWhereInBatchSize(...args), 2)
  }
})

describe('GalleryAlbumDatabase', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    const ownerId: string = actors.empty.id
    const followersUrl = `${ownerId}/followers`
    const strangerId = actors.extra.id
    const mentionedId = actors.pollAuthor.id
    const otherActorId = actors.replyAuthor.id
    let ownerAccountId = ''

    const audiences: Record<string, GalleryAudience> = {
      owner: OWNER_GALLERY_AUDIENCE,
      'logged out': PUBLIC_GALLERY_AUDIENCE,
      stranger: {
        kind: 'viewer',
        publicOnly: false,
        visibleToActorId: strangerId,
        includeFollowersOnly: false,
        followersAudience: followersUrl
      },
      follower: {
        kind: 'viewer',
        publicOnly: false,
        visibleToActorId: strangerId,
        includeFollowersOnly: true,
        followersAudience: followersUrl
      },
      'mentioned actor': {
        kind: 'viewer',
        publicOnly: false,
        visibleToActorId: mentionedId,
        includeFollowersOnly: false,
        followersAudience: followersUrl
      },
      // All flags falsy reads as "no filter" to the status builder; the
      // gallery must coerce it to the logged-out view instead.
      'viewer with no flags': {
        kind: 'viewer',
        publicOnly: false,
        visibleToActorId: null,
        includeFollowersOnly: false,
        followersAudience: null
      }
    }

    const ids: Record<string, string> = {}
    let counter = 0

    const statusId = (name: string, actorId = ownerId) =>
      `${actorId}/statuses/album-${name}`

    const createMedia = async (
      name: string,
      details: Partial<MediaDetailsRecord> = {},
      actorId = ownerId
    ) => {
      const media = await database.createMedia({
        actorId,
        original: {
          path: `/test/album-${name}.jpg`,
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: { width: 100, height: 100 }
        },
        details: { inGallery: true, ...details }
      })
      ids[name] = media!.id
      return media!.id
    }

    const post = async (
      name: string,
      mediaName: string,
      to: string[],
      cc: string[] = [],
      actorId = ownerId
    ) => {
      await database.createNote({
        id: statusId(name, actorId),
        url: statusId(name, actorId),
        actorId,
        to,
        cc,
        text: name
      })
      await database.createAttachment({
        actorId,
        statusId: statusId(name, actorId),
        mediaType: 'image/jpeg',
        url: `https://media.test/${name}.jpg`,
        width: 100,
        height: 100,
        mediaId: ids[mediaName]
      })
    }

    // One media on its own post, created in this order (so ids ascend).
    const addPhoto = async (
      name: string,
      to: string[],
      details: Partial<MediaDetailsRecord> = {},
      cc: string[] = []
    ) => {
      await createMedia(name, details)
      await post(name, name, to, cc)
    }

    const namesOf = (mediaIds: string[]) => {
      const byId = Object.fromEntries(
        Object.entries(ids).map(([name, id]) => [id, name])
      )
      return mediaIds.map((id) => byId[id] ?? `unknown:${id}`)
    }

    const createAlbum = async (
      title: string,
      options: { visibility?: 'public' | 'private'; actorId?: string } = {}
    ) => {
      const result = await database.createGalleryAlbumWithinLimit({
        actorId: options.actorId ?? ownerId,
        title,
        visibility: options.visibility,
        limit: MAX_GALLERY_ALBUMS_PER_ACTOR
      })
      if (result.status !== 'created') throw new Error('album not created')
      return result.album
    }

    const addItems = (albumId: string, names: string[], limit = 2000) =>
      database.addGalleryAlbumItems({
        albumId,
        actorId: ownerId,
        mediaIds: names.map((name) => ids[name]),
        limit
      })

    const mediaOf = async (
      albumId: string,
      audience: GalleryAudience,
      options: {
        sort?: GalleryAlbumSort
        after?: GalleryAlbumCursor
        limit?: number
        subjectKey?: string
      } = {}
    ) =>
      database.getGalleryAlbumMedia({
        albumId,
        actorId: ownerId,
        audience,
        sort: options.sort ?? 'taken_desc',
        after: options.after,
        limit: options.limit ?? 100,
        subjectKey: options.subjectKey
      })

    const namesIn = async (
      albumId: string,
      audience: GalleryAudience,
      sort: GalleryAlbumSort = 'taken_desc'
    ) =>
      namesOf(
        (await mediaOf(albumId, audience, { sort })).map((row) => row.media.id)
      )

    beforeAll(async () => {
      await seedDatabase(database)
      const owner = await database.getActorFromId({ id: ownerId })
      ownerAccountId = owner!.account!.id

      // Taken dates: public and public2 tie on purpose.
      await addPhoto('public', [ACTIVITY_STREAM_PUBLIC], {
        takenAt: Date.UTC(2024, 0, 1),
        subjectName: 'Common Kingfisher',
        subjectScientificName: 'Alcedo atthis'
      })
      await addPhoto('public2', [ACTIVITY_STREAM_PUBLIC], {
        takenAt: Date.UTC(2024, 0, 1),
        subjectName: 'Red Fox'
      })
      await addPhoto('followers', [followersUrl], {
        takenAt: Date.UTC(2024, 1, 1)
      })
      await addPhoto(
        'unlisted',
        [followersUrl],
        {
          takenAt: Date.UTC(2024, 2, 1)
        },
        [ACTIVITY_STREAM_PUBLIC]
      )
      await addPhoto('direct', [mentionedId], {
        takenAt: Date.UTC(2024, 3, 1)
      })
      // No capture date: ordered by its upload date.
      await addPhoto('undated', [ACTIVITY_STREAM_PUBLIC])
      await addPhoto('doomed', [ACTIVITY_STREAM_PUBLIC], {
        takenAt: Date.UTC(2024, 4, 1)
      })

      await createMedia('hidden', { inGallery: false })
      await post('hidden', 'hidden', [ACTIVITY_STREAM_PUBLIC])
      // In the gallery but never posted.
      await createMedia('unposted')
      // Another actor's own public photo.
      await createMedia('foreign', {}, otherActorId)
      await post(
        'foreign',
        'foreign',
        [ACTIVITY_STREAM_PUBLIC],
        [],
        otherActorId
      )
    })

    afterAll(async () => {
      await database.destroy()
    })

    const uniqueTitle = () => {
      counter += 1
      return `Album ${counter}`
    }

    describe('createGalleryAlbumWithinLimit', () => {
      it('creates a public album with defaults', async () => {
        const album = await createAlbum(uniqueTitle())

        expect(album).toMatchObject({
          actorId: ownerId,
          description: null,
          coverMediaId: null,
          visibility: 'public',
          sortOrder: 'taken_desc'
        })
        expect(album.id).toBeString()
      })

      it('refuses past the per-actor cap and inserts nothing', async () => {
        const actorId = actors.followRequester.id
        const make = (title: string) =>
          database.createGalleryAlbumWithinLimit({
            actorId,
            title,
            limit: 2
          })

        expect((await make('One')).status).toBe('created')
        expect((await make('Two')).status).toBe('created')
        expect(await make('Three')).toEqual({ status: 'limit-reached' })

        const summaries = await database.getGalleryAlbumSummaries({
          actorId,
          audience: OWNER_GALLERY_AUDIENCE
        })
        expect(summaries.map((summary) => summary.album.title).sort()).toEqual([
          'One',
          'Two'
        ])
      })

      it('counts only the actor own albums toward the cap', async () => {
        const result = await database.createGalleryAlbumWithinLimit({
          actorId: actors.followRequester.id,
          title: 'Other',
          limit: 3
        })
        expect(result.status).toBe('created')
      })
    })

    describe('addGalleryAlbumItems', () => {
      it('adds the actor own gallery media and skips everything else', async () => {
        const album = await createAlbum(uniqueTitle())

        const result = await database.addGalleryAlbumItems({
          albumId: album.id,
          actorId: ownerId,
          mediaIds: [
            ids.public,
            ids.foreign,
            ids.hidden,
            ids.unposted,
            '999999',
            'not-an-id'
          ],
          limit: MAX_GALLERY_ALBUM_ITEMS
        })

        expect(result).toEqual({
          status: 'added',
          added: [ids.public],
          existing: [],
          skipped: expect.arrayContaining([
            ids.foreign,
            ids.hidden,
            ids.unposted,
            '999999',
            'not-an-id'
          ])
        })
        expect(await namesIn(album.id, OWNER_GALLERY_AUDIENCE)).toEqual([
          'public'
        ])
      })

      it('reports media already in the album as existing and adds it once', async () => {
        const album = await createAlbum(uniqueTitle())
        await addItems(album.id, ['public'])

        const result = await addItems(album.id, ['public', 'public2'])

        expect(result).toMatchObject({
          status: 'added',
          added: [ids.public2],
          existing: [ids.public],
          skipped: []
        })
        expect(await namesIn(album.id, OWNER_GALLERY_AUDIENCE)).toHaveLength(2)
      })

      it('does not add to somebody else album', async () => {
        const album = await createAlbum(uniqueTitle())

        expect(
          await database.addGalleryAlbumItems({
            albumId: album.id,
            actorId: otherActorId,
            mediaIds: [ids.foreign],
            limit: MAX_GALLERY_ALBUM_ITEMS
          })
        ).toEqual({ status: 'not-found' })
        expect(
          await database.addGalleryAlbumItems({
            albumId: 'missing',
            actorId: ownerId,
            mediaIds: [ids.public],
            limit: MAX_GALLERY_ALBUM_ITEMS
          })
        ).toEqual({ status: 'not-found' })
      })

      it('is atomic at the item cap: a request that would pass it adds nothing', async () => {
        const album = await createAlbum(uniqueTitle())
        await addItems(album.id, ['public'], 2)

        expect(await addItems(album.id, ['public2', 'followers'], 2)).toEqual({
          status: 'limit-reached'
        })
        expect(await namesIn(album.id, OWNER_GALLERY_AUDIENCE)).toEqual([
          'public'
        ])

        expect(await addItems(album.id, ['public2'], 2)).toMatchObject({
          status: 'added',
          added: [ids.public2]
        })
      })

      it('lets a request that only repeats existing items through at the cap', async () => {
        const album = await createAlbum(uniqueTitle())
        await addItems(album.id, ['public', 'public2'], 2)

        expect(await addItems(album.id, ['public'], 2)).toMatchObject({
          status: 'added',
          added: [],
          existing: [ids.public]
        })
      })
    })

    describe('scope matrix', () => {
      let albumId = ''

      beforeAll(async () => {
        const album = await createAlbum(uniqueTitle())
        albumId = album.id
        await addItems(albumId, [
          'public',
          'public2',
          'followers',
          'unlisted',
          'direct',
          'undated',
          'doomed'
        ])
        // The cover is a followers-only photo.
        await database.updateGalleryAlbum({
          id: albumId,
          actorId: ownerId,
          coverMediaId: ids.followers
        })
        // A deleted post drops its photo, even for the owner.
        await database.deleteStatus({ statusId: statusId('doomed') })
        // Taken newest first; `undated` falls back to its upload date, which is
        // after every taken date here.
      })

      // `undated` has no capture date, so it sorts by when it was uploaded: now.
      const expected: Record<string, string[]> = {
        owner: [
          'undated',
          'direct',
          'unlisted',
          'followers',
          'public2',
          'public'
        ],
        'logged out': ['undated', 'unlisted', 'public2', 'public'],
        stranger: ['undated', 'unlisted', 'public2', 'public'],
        follower: ['undated', 'unlisted', 'followers', 'public2', 'public'],
        'mentioned actor': [
          'undated',
          'direct',
          'unlisted',
          'public2',
          'public'
        ],
        'viewer with no flags': ['undated', 'unlisted', 'public2', 'public']
      }

      it.each(Object.keys(expected))(
        'shows the %s only the media of posts they may read',
        async (name) => {
          expect(await namesIn(albumId, audiences[name])).toEqual(
            expected[name]
          )
        }
      )

      it.each(Object.keys(expected))(
        'counts, dates and previews for the %s come from visible items only',
        async (name) => {
          const [summary] = await database.getGalleryAlbumSummaries({
            actorId: ownerId,
            audience: audiences[name],
            albumId
          })
          const visible = expected[name]

          expect(summary.itemCount).toBe(visible.length)
          const previews = namesOf(summary.previewMediaIds)
          expect(previews).toHaveLength(Math.min(3, visible.length))
          expect(previews.every((preview) => visible.includes(preview))).toBe(
            true
          )
          // The oldest visible capture date is `public`'s, the newest is the
          // upload date of `undated`.
          expect(summary.firstAt).toBe(Date.UTC(2024, 0, 1))
          expect(summary.lastAt).toBeGreaterThan(Date.UTC(2024, 4, 1))
        }
      )

      it('uses the explicit cover only when the audience can see it', async () => {
        const coverFor = async (name: string) => {
          const [summary] = await database.getGalleryAlbumSummaries({
            actorId: ownerId,
            audience: audiences[name],
            albumId
          })
          return namesOf([summary.coverMediaId!])[0]
        }

        expect(await coverFor('owner')).toBe('followers')
        expect(await coverFor('follower')).toBe('followers')
        // Never a hidden item: a stranger falls back to the newest visible one.
        expect(await coverFor('stranger')).toBe('undated')
        expect(await coverFor('logged out')).toBe('undated')
      })

      it('never previews a hidden item in a collage', async () => {
        const [summary] = await database.getGalleryAlbumSummaries({
          actorId: ownerId,
          audience: audiences.stranger,
          albumId
        })
        expect(namesOf(summary.previewMediaIds)).not.toContain('followers')
        expect(namesOf(summary.previewMediaIds)).not.toContain('direct')
      })

      it('reads the index for facts from visible items only', async () => {
        const rows = await database.getGalleryAlbumIndex({
          albumId,
          actorId: ownerId,
          audience: PUBLIC_GALLERY_AUDIENCE
        })
        expect(namesOf(rows.map((row) => row.id)).sort()).toEqual(
          [...expected['logged out']].sort()
        )
      })

      it('also hides a photo taken out of the gallery', async () => {
        const album = await createAlbum(uniqueTitle())
        await addItems(album.id, ['public2', 'public'])
        await database.updateMedia({
          mediaId: ids.public2,
          accountId: ownerAccountId,
          details: { inGallery: false }
        })

        expect(await namesIn(album.id, OWNER_GALLERY_AUDIENCE)).toEqual([
          'public'
        ])

        await database.updateMedia({
          mediaId: ids.public2,
          accountId: ownerAccountId,
          details: { inGallery: true }
        })
      })

      it('returns a private album and an empty one to the owner only', async () => {
        const secret = await createAlbum(uniqueTitle(), {
          visibility: 'private'
        })
        await addItems(secret.id, ['public'])
        const empty = await createAlbum(uniqueTitle())
        const followersOnly = await createAlbum(uniqueTitle())
        await addItems(followersOnly.id, ['followers'])

        const get = (id: string, name: string) =>
          database.getGalleryAlbum({
            id,
            actorId: ownerId,
            audience: audiences[name]
          })

        expect(await get(secret.id, 'owner')).not.toBeNull()
        expect(await get(secret.id, 'logged out')).toBeNull()
        expect(await get(secret.id, 'follower')).toBeNull()
        expect(await get(empty.id, 'owner')).not.toBeNull()
        expect(await get(empty.id, 'logged out')).toBeNull()
        // Public, but nothing in it is visible to this audience: as good as
        // missing, the same answer a missing id gets.
        expect(await get(followersOnly.id, 'stranger')).toBeNull()
        expect(await get(followersOnly.id, 'follower')).not.toBeNull()
        expect(await get('missing', 'owner')).toBeNull()
        expect(await mediaOf(secret.id, audiences['logged out'])).toEqual([])
        expect(
          await database.getGalleryAlbumIndex({
            albumId: secret.id,
            actorId: ownerId,
            audience: audiences['logged out']
          })
        ).toEqual([])
      })

      it('lists only public albums with something visible to a visitor', async () => {
        const actorId = actors.followRequester.id
        await createAlbum('Visitor public', { actorId })
        const summariesFor = (audience: GalleryAudience) =>
          database.getGalleryAlbumSummaries({ actorId: ownerId, audience })

        const owner = await summariesFor(OWNER_GALLERY_AUDIENCE)
        const stranger = await summariesFor(audiences.stranger)

        expect(stranger.length).toBeGreaterThan(0)
        expect(owner.length).toBeGreaterThan(stranger.length)
        for (const summary of stranger) {
          expect(summary.album.visibility).toBe('public')
          expect(summary.itemCount).toBeGreaterThan(0)
        }
        // Last updated first.
        const updated = owner.map((summary) => summary.album.updatedAt)
        expect(updated).toEqual([...updated].sort((a, b) => b - a))
      })
    })

    describe('getGalleryAlbumMedia', () => {
      let albumId = ''

      beforeAll(async () => {
        const album = await createAlbum(uniqueTitle())
        albumId = album.id
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
          // Added one at a time, in this order, at distinct times.
          for (const [index, name] of [
            'unlisted',
            'public',
            'direct',
            'public2',
            'followers'
          ].entries()) {
            vi.setSystemTime(Date.UTC(2025, 0, 1, 0, 0, index))
            await addItems(albumId, [name])
          }
        } finally {
          vi.useRealTimers()
        }
      })

      it.each([
        // Taken: direct 04-01, unlisted 03-01, followers 02-01, then the tie
        // at 01-01 broken by media id (public2 is newer).
        [
          'taken_desc',
          ['direct', 'unlisted', 'followers', 'public2', 'public']
        ],
        ['taken_asc', ['public', 'public2', 'followers', 'unlisted', 'direct']],
        ['added_desc', ['followers', 'public2', 'direct', 'public', 'unlisted']]
      ] as const)('orders by %s', async (sort, names) => {
        expect(await namesIn(albumId, OWNER_GALLERY_AUDIENCE, sort)).toEqual(
          names
        )
      })

      it.each(['taken_desc', 'taken_asc', 'added_desc'] as const)(
        'pages through %s with a keyset cursor, ties included',
        async (sort) => {
          const all = await namesIn(albumId, OWNER_GALLERY_AUDIENCE, sort)
          const seen: string[] = []
          let after: GalleryAlbumCursor | undefined
          for (let pages = 0; pages < 10; pages += 1) {
            const rows = await mediaOf(albumId, OWNER_GALLERY_AUDIENCE, {
              sort,
              after,
              limit: 2
            })
            if (rows.length === 0) break
            seen.push(...namesOf(rows.map((row) => row.media.id)))
            const last = rows[rows.length - 1]
            after = { key: last.sortKey, mediaId: Number(last.media.id) }
          }

          expect(seen).toEqual(all)
        }
      )

      it('breaks a tie on the media id when the cursor lands inside it', async () => {
        const first = await mediaOf(albumId, OWNER_GALLERY_AUDIENCE, {
          sort: 'taken_desc',
          limit: 4
        })
        // public2 and public share a capture date; the page ends on public2.
        expect(namesOf(first.map((row) => row.media.id))).toEqual([
          'direct',
          'unlisted',
          'followers',
          'public2'
        ])
        const last = first[first.length - 1]

        const next = await mediaOf(albumId, OWNER_GALLERY_AUDIENCE, {
          sort: 'taken_desc',
          after: { key: last.sortKey, mediaId: Number(last.media.id) },
          limit: 4
        })
        expect(namesOf(next.map((row) => row.media.id))).toEqual(['public'])
      })

      it('carries the post each photo is shown through', async () => {
        const [row] = await mediaOf(albumId, PUBLIC_GALLERY_AUDIENCE, {
          limit: 1
        })
        expect(row.statusId).toBe(statusId('unlisted'))
        expect(row.attachment.mediaId).toBe(row.media.id)
      })

      it('filters to one species', async () => {
        const rows = await mediaOf(albumId, OWNER_GALLERY_AUDIENCE, {
          subjectKey: 'sci:alcedo atthis'
        })
        expect(namesOf(rows.map((row) => row.media.id))).toEqual(['public'])
      })

      it('returns nothing for a size of zero or a missing album', async () => {
        expect(
          await mediaOf(albumId, OWNER_GALLERY_AUDIENCE, { limit: 0 })
        ).toEqual([])
        expect(await mediaOf('missing', OWNER_GALLERY_AUDIENCE)).toEqual([])
      })
    })

    describe('updateGalleryAlbum', () => {
      it('updates the given fields and leaves the rest', async () => {
        const album = await createAlbum(uniqueTitle())

        const result = await database.updateGalleryAlbum({
          id: album.id,
          actorId: ownerId,
          title: 'Renamed',
          description: 'About',
          visibility: 'private',
          sortOrder: 'taken_asc'
        })

        expect(result).toMatchObject({
          status: 'updated',
          album: {
            title: 'Renamed',
            description: 'About',
            visibility: 'private',
            sortOrder: 'taken_asc'
          }
        })

        const cleared = await database.updateGalleryAlbum({
          id: album.id,
          actorId: ownerId,
          description: null
        })
        expect(cleared).toMatchObject({
          album: { title: 'Renamed', description: null, visibility: 'private' }
        })
      })

      it('is not found for a missing or foreign album', async () => {
        const album = await createAlbum(uniqueTitle())
        expect(
          await database.updateGalleryAlbum({
            id: album.id,
            actorId: otherActorId,
            title: 'Mine now'
          })
        ).toEqual({ status: 'not-found' })
      })

      it('requires the cover to be one of the album items', async () => {
        const album = await createAlbum(uniqueTitle())
        await addItems(album.id, ['public'])
        const set = (coverMediaId: string | null) =>
          database.updateGalleryAlbum({
            id: album.id,
            actorId: ownerId,
            coverMediaId
          })

        expect(await set(ids.public2)).toEqual({ status: 'invalid-cover' })
        expect(await set(ids.foreign)).toEqual({ status: 'invalid-cover' })
        expect(await set('nope')).toEqual({ status: 'invalid-cover' })
        expect(await set(ids.public)).toMatchObject({
          album: { coverMediaId: ids.public }
        })
        expect(await set(null)).toMatchObject({ album: { coverMediaId: null } })
      })

      it('falls back to the newest visible item without an explicit cover', async () => {
        const album = await createAlbum(uniqueTitle())
        await addItems(album.id, ['public', 'unlisted'])

        const [summary] = await database.getGalleryAlbumSummaries({
          actorId: ownerId,
          audience: OWNER_GALLERY_AUDIENCE,
          albumId: album.id
        })
        expect(namesOf([summary.coverMediaId!])).toEqual(['unlisted'])
      })
    })

    describe('removeGalleryAlbumItems', () => {
      it('removes items, keeps the media and clears a removed cover', async () => {
        const album = await createAlbum(uniqueTitle())
        await addItems(album.id, ['public', 'public2'])
        await database.updateGalleryAlbum({
          id: album.id,
          actorId: ownerId,
          coverMediaId: ids.public
        })

        const result = await database.removeGalleryAlbumItems({
          albumId: album.id,
          actorId: ownerId,
          mediaIds: [ids.public, ids.followers]
        })

        expect(result).toEqual({ status: 'removed', removed: [ids.public] })
        expect(
          await database.getGalleryAlbum({
            id: album.id,
            actorId: ownerId,
            audience: OWNER_GALLERY_AUDIENCE
          })
        ).toMatchObject({ coverMediaId: null })
        expect(await namesIn(album.id, OWNER_GALLERY_AUDIENCE)).toEqual([
          'public2'
        ])
        expect(
          await database.getMediaByIdForAccount({
            mediaId: ids.public,
            accountId: ownerAccountId
          })
        ).not.toBeNull()
      })

      it('is not found for a foreign album', async () => {
        const album = await createAlbum(uniqueTitle())
        expect(
          await database.removeGalleryAlbumItems({
            albumId: album.id,
            actorId: otherActorId,
            mediaIds: [ids.public]
          })
        ).toEqual({ status: 'not-found' })
      })
    })

    describe('deleteGalleryAlbum', () => {
      it('deletes the album and its items but keeps the media and its post', async () => {
        const album = await createAlbum(uniqueTitle())
        await addItems(album.id, ['public', 'public2'])

        expect(
          await database.deleteGalleryAlbum({ id: album.id, actorId: ownerId })
        ).toBeTrue()

        expect(
          await database.getGalleryAlbum({
            id: album.id,
            actorId: ownerId,
            audience: OWNER_GALLERY_AUDIENCE
          })
        ).toBeNull()
        expect(
          await database.getAlbumsForMedia({
            mediaId: ids.public,
            actorId: ownerId,
            audience: OWNER_GALLERY_AUDIENCE
          })
        ).not.toContainEqual({ id: album.id, title: album.title })
        expect(
          await database.getMediaByIdForAccount({
            mediaId: ids.public,
            accountId: ownerAccountId
          })
        ).not.toBeNull()
        expect(
          await database.getStatus({ statusId: statusId('public') })
        ).not.toBeNull()
      })

      it('is false for a missing or foreign album and leaves it alone', async () => {
        const album = await createAlbum(uniqueTitle())
        await addItems(album.id, ['public'])

        expect(
          await database.deleteGalleryAlbum({
            id: album.id,
            actorId: otherActorId
          })
        ).toBeFalse()
        expect(
          await database.deleteGalleryAlbum({ id: 'missing', actorId: ownerId })
        ).toBeFalse()
        expect(await namesIn(album.id, OWNER_GALLERY_AUDIENCE)).toEqual([
          'public'
        ])
      })
    })

    describe('countGalleryAlbumMedia', () => {
      it('counts distinct visible media across albums, public albums only for a visitor', async () => {
        const actorId = actors.followRequester.id
        const make = async (name: string, visibility: 'public' | 'private') => {
          await createMedia(name, {}, actorId)
          await post(name, name, [ACTIVITY_STREAM_PUBLIC], [], actorId)
          const created = await database.createGalleryAlbumWithinLimit({
            actorId,
            title: name,
            visibility,
            limit: 200
          })
          if (created.status !== 'created') throw new Error('not created')
          return created.album.id
        }
        const count = (audience: GalleryAudience) =>
          database.countGalleryAlbumMedia({ actorId, audience })
        expect(await count(OWNER_GALLERY_AUDIENCE)).toBe(0)

        const open = await make('count-open', 'public')
        const secret = await make('count-secret', 'private')
        for (const albumId of [open, secret]) {
          await database.addGalleryAlbumItems({
            albumId,
            actorId,
            mediaIds: [ids['count-open'], ids['count-secret']],
            limit: 2000
          })
        }

        // Each photo is in two albums and counts once.
        expect(await count(OWNER_GALLERY_AUDIENCE)).toBe(2)
        // The visitor counts through the public album only, and both photos
        // are in it.
        expect(await count(PUBLIC_GALLERY_AUDIENCE)).toBe(2)

        await database.deleteGalleryAlbum({ id: open, actorId })
        expect(await count(OWNER_GALLERY_AUDIENCE)).toBe(2)
        expect(await count(PUBLIC_GALLERY_AUDIENCE)).toBe(0)
      })
    })

    describe('getAlbumsForMedia', () => {
      it('lists the albums a media is in, for the owner only', async () => {
        await addPhoto('multi', [ACTIVITY_STREAM_PUBLIC])
        const first = await createAlbum(uniqueTitle())
        const second = await createAlbum(uniqueTitle())
        await addItems(first.id, ['multi'])
        await addItems(second.id, ['multi'])

        const owner = await database.getAlbumsForMedia({
          mediaId: ids.multi,
          actorId: ownerId,
          audience: OWNER_GALLERY_AUDIENCE
        })
        expect(owner.map((album) => album.id).sort()).toEqual(
          [first.id, second.id].sort()
        )

        for (const name of Object.keys(audiences).filter(
          (audience) => audience !== 'owner'
        )) {
          expect(
            await database.getAlbumsForMedia({
              mediaId: ids.multi,
              actorId: ownerId,
              audience: audiences[name]
            })
          ).toEqual([])
        }
      })

      it('lists nothing for an invalid id', async () => {
        expect(
          await database.getAlbumsForMedia({
            mediaId: 'x',
            actorId: ownerId,
            audience: OWNER_GALLERY_AUDIENCE
          })
        ).toEqual([])
      })
    })

    describe('when a media is deleted', () => {
      it('removes its album items and clears covers (deleteMedia)', async () => {
        await addPhoto('cascade', [ACTIVITY_STREAM_PUBLIC])
        const album = await createAlbum(uniqueTitle())
        await addItems(album.id, ['cascade', 'public'])
        await database.updateGalleryAlbum({
          id: album.id,
          actorId: ownerId,
          coverMediaId: ids.cascade
        })

        expect(await database.deleteMedia({ mediaId: ids.cascade })).toBeTrue()

        expect(
          await database.getGalleryAlbum({
            id: album.id,
            actorId: ownerId,
            audience: OWNER_GALLERY_AUDIENCE
          })
        ).toMatchObject({ coverMediaId: null })
        expect(await namesIn(album.id, OWNER_GALLERY_AUDIENCE)).toEqual([
          'public'
        ])
        // The row is gone, not merely hidden: a new item cannot reuse it.
        expect(
          await database.getAlbumsForMedia({
            mediaId: ids.cascade,
            actorId: ownerId,
            audience: OWNER_GALLERY_AUDIENCE
          })
        ).toEqual([])
      })

      it('removes its album items and clears covers (deleteMediaForAccount)', async () => {
        await addPhoto('cascade-account', [ACTIVITY_STREAM_PUBLIC])
        const album = await createAlbum(uniqueTitle())
        await addItems(album.id, ['cascade-account', 'public'])
        await database.updateGalleryAlbum({
          id: album.id,
          actorId: ownerId,
          coverMediaId: ids['cascade-account']
        })
        // A media a post still uses is refused, so the post goes first.
        await database.deleteStatus({ statusId: statusId('cascade-account') })

        const result = await database.deleteMediaForAccount({
          mediaId: ids['cascade-account'],
          accountId: ownerAccountId
        })
        expect(result.status).toBe('deleted')

        expect(
          await database.getGalleryAlbum({
            id: album.id,
            actorId: ownerId,
            audience: OWNER_GALLERY_AUDIENCE
          })
        ).toMatchObject({ coverMediaId: null })
        expect(
          await database.getAlbumsForMedia({
            mediaId: ids['cascade-account'],
            actorId: ownerId,
            audience: OWNER_GALLERY_AUDIENCE
          })
        ).toEqual([])
        expect(await namesIn(album.id, OWNER_GALLERY_AUDIENCE)).toEqual([
          'public'
        ])
      })
    })
  })
})
