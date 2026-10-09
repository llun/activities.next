import type { GalleryAlbumCursor } from '@/lib/database/sql/galleryAlbums'
import { useGalleryAlbumsFixture } from '@/lib/database/sql/galleryAlbumsTestFixture'
import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestDatabaseWithInstance
} from '@/lib/database/testUtils'
import {
  OWNER_GALLERY_AUDIENCE,
  PUBLIC_GALLERY_AUDIENCE
} from '@/lib/services/gallery/galleryAudience'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import {
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
    const {
      ownerId,
      otherActorId,
      audiences,
      ids,
      statusId,
      addPhoto,
      namesOf,
      createAlbum,
      addItems,
      mediaOf,
      namesIn,
      uniqueTitle,
      getOwnerAccountId
    } = useGalleryAlbumsFixture(database)
    let ownerAccountId = ''

    beforeAll(() => {
      ownerAccountId = getOwnerAccountId()
    })

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

      it('refuses past the per-actor cap, counting only the actor own albums', async () => {
        // Its own actor, so no other test's albums count toward the cap.
        const actorId = actors.primary.id
        // Another actor's album must not count toward this one's cap.
        await createAlbum(uniqueTitle())
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

      it('holds the cap under concurrent creates', async () => {
        // Its own actor: three creates race for two places.
        const actorId = actors.pollAuthor.id

        const results = await Promise.all(
          ['A', 'B', 'C'].map((title) =>
            database.createGalleryAlbumWithinLimit({
              actorId,
              title,
              limit: 2
            })
          )
        )

        expect(results.filter((r) => r.status === 'created')).toHaveLength(2)
        expect(
          results.filter((r) => r.status === 'limit-reached')
        ).toHaveLength(1)
        expect(
          await database.getGalleryAlbumSummaries({
            actorId,
            audience: OWNER_GALLERY_AUDIENCE
          })
        ).toHaveLength(2)
      })

      it('creates the album and its first photos together', async () => {
        const result = await database.createGalleryAlbumWithinLimit({
          actorId: ownerId,
          title: uniqueTitle(),
          limit: MAX_GALLERY_ALBUMS_PER_ACTOR,
          mediaIds: [ids.public, ids.foreign, ids.hidden, ids.public],
          itemLimit: MAX_GALLERY_ALBUM_ITEMS
        })

        if (result.status !== 'created') throw new Error('not created')
        expect(result.added).toEqual([ids.public])
        expect(result.existing).toEqual([])
        expect(result.skipped).toEqual(
          expect.arrayContaining([ids.foreign, ids.hidden])
        )
        expect(await namesIn(result.album.id, OWNER_GALLERY_AUDIENCE)).toEqual([
          'public'
        ])
      })

      it('creates nothing when the first photos cannot be added', async () => {
        const titles = async () =>
          (
            await database.getGalleryAlbumSummaries({
              actorId: ownerId,
              audience: OWNER_GALLERY_AUDIENCE
            })
          ).map((summary) => summary.album.title)
        const title = uniqueTitle()
        expect(await titles()).not.toContain(title)

        // Two photos against an item cap of one: the add cannot be made, so
        // the album is rolled back with it.
        await expect(
          database.createGalleryAlbumWithinLimit({
            actorId: ownerId,
            title,
            limit: MAX_GALLERY_ALBUMS_PER_ACTOR,
            mediaIds: [ids.public, ids.public2],
            itemLimit: 1
          })
        ).rejects.toThrow()

        expect(await titles()).not.toContain(title)
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

      it('counts a photo whose post was deleted against the cap, and reports it', async () => {
        await addPhoto('cap-gone', [ACTIVITY_STREAM_PUBLIC])
        const album = await createAlbum(uniqueTitle())
        await addItems(album.id, ['public', 'cap-gone'], 2)
        // The post goes, the media and its album row stay: the owner no longer
        // sees the photo, but it still takes one of the two places.
        await database.deleteStatus({ statusId: statusId('cap-gone') })
        expect(await namesIn(album.id, OWNER_GALLERY_AUDIENCE)).toEqual([
          'public'
        ])

        expect(
          await database.countGalleryAlbumStoredItems({
            albumId: album.id,
            actorId: ownerId
          })
        ).toBe(2)
        expect(await addItems(album.id, ['public2'], 2)).toEqual({
          status: 'limit-reached'
        })
        expect(await namesIn(album.id, OWNER_GALLERY_AUDIENCE)).toEqual([
          'public'
        ])
        // Repeating what is already there still passes at the cap.
        expect(await addItems(album.id, ['public'], 2)).toMatchObject({
          status: 'added',
          added: [],
          existing: [ids.public]
        })
      })

      it('reports no stored items for a missing or foreign album', async () => {
        const album = await createAlbum(uniqueTitle())
        await addItems(album.id, ['public'])
        expect(
          await database.countGalleryAlbumStoredItems({
            albumId: album.id,
            actorId: otherActorId
          })
        ).toBe(0)
        expect(
          await database.countGalleryAlbumStoredItems({
            albumId: 'missing',
            actorId: ownerId
          })
        ).toBe(0)
      })

      it('holds the item cap under concurrent adds', async () => {
        const album = await createAlbum(uniqueTitle())
        await addItems(album.id, ['public'], 2)

        // Each fits alone (one item left), both do not.
        const results = await Promise.all([
          addItems(album.id, ['public2'], 2),
          addItems(album.id, ['followers'], 2)
        ])

        expect(results.filter((r) => r.status === 'added')).toHaveLength(1)
        expect(
          results.filter((r) => r.status === 'limit-reached')
        ).toHaveLength(1)
        expect(await namesIn(album.id, OWNER_GALLERY_AUDIENCE)).toHaveLength(2)
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

      it('never leaves a cover that is not an item when a cover is set while the photo is removed', async () => {
        for (let round = 0; round < 5; round += 1) {
          const album = await createAlbum(uniqueTitle())
          await addItems(album.id, ['public', 'public2'])

          const [patched] = await Promise.all([
            database.updateGalleryAlbum({
              id: album.id,
              actorId: ownerId,
              coverMediaId: ids.public
            }),
            database.removeGalleryAlbumItems({
              albumId: album.id,
              actorId: ownerId,
              mediaIds: [ids.public]
            })
          ])

          const after = await database.getGalleryAlbum({
            id: album.id,
            actorId: ownerId,
            audience: OWNER_GALLERY_AUDIENCE
          })
          // Either the cover was set first and the removal cleared it, or the
          // removal came first and the cover was refused.
          expect(after!.coverMediaId).toBeNull()
          expect(['updated', 'invalid-cover']).toContain(patched.status)
          expect(await namesIn(album.id, OWNER_GALLERY_AUDIENCE)).toEqual([
            'public2'
          ])
        }
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
      it('never leaves a cover on a media deleted while the cover is set', async () => {
        for (let round = 0; round < 3; round += 1) {
          const name = `race-${round}`
          await addPhoto(name, [ACTIVITY_STREAM_PUBLIC])
          const album = await createAlbum(uniqueTitle())
          await addItems(album.id, [name, 'public'])

          const [deleted, patched] = await Promise.all([
            database.deleteMedia({ mediaId: ids[name] }),
            database.updateGalleryAlbum({
              id: album.id,
              actorId: ownerId,
              coverMediaId: ids[name]
            })
          ])

          expect(deleted).toBeTrue()
          expect(['updated', 'invalid-cover']).toContain(patched.status)
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
        }
      })

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

describe('gallery albums when an account is deleted', () => {
  // Its own database: the account is really removed, which no other test in
  // this file may see.
  const { database, instance, prepare } = getTestDatabaseWithInstance(true)

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    // SQLite may run without foreign keys, so nothing cascades there: the
    // delete itself has to remove the rows. (PostgreSQL always cascades, so
    // this proves the explicit deletes on SQLite only.)
    if (instance.client.config.client === 'better-sqlite3') {
      await instance.raw('PRAGMA foreign_keys = OFF')
    }
  })

  afterAll(async () => {
    await database.destroy()
  })

  const countRows = async (table: string, actorId: string) => {
    const row = await instance(table)
      .where('actorId', actorId)
      .count<{ total: number | string }[]>({ total: '*' })
      .first()
    return Number(row?.total ?? 0)
  }

  it('does not count an item whose media is gone against the cap', async () => {
    const username = `album-orphan-${crypto.randomUUID().slice(0, 8)}`
    const actorId = `https://${TEST_DOMAIN}/users/${username}`
    await database.createAccount({
      email: `${username}@${TEST_DOMAIN}`,
      username,
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: `privateKey-${username}`,
      publicKey: `publicKey-${username}`
    })
    const mediaIds: string[] = []
    for (const name of ['one', 'two', 'three']) {
      const statusId = `${actorId}/statuses/album-orphan-${name}`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: name
      })
      const media = await database.createMedia({
        actorId,
        original: {
          path: `/test/album-orphan-${name}.jpg`,
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: { width: 100, height: 100 }
        },
        details: { inGallery: true }
      })
      mediaIds.push(media!.id)
      await database.createAttachment({
        actorId,
        statusId,
        mediaType: 'image/jpeg',
        url: `https://media.test/album-orphan-${name}.jpg`,
        width: 100,
        height: 100,
        mediaId: media!.id
      })
    }
    const created = await database.createGalleryAlbumWithinLimit({
      actorId,
      title: 'Orphans',
      limit: MAX_GALLERY_ALBUMS_PER_ACTOR
    })
    if (created.status !== 'created') throw new Error('not created')
    const add = (ids: string[], limit: number) =>
      database.addGalleryAlbumItems({
        albumId: created.album.id,
        actorId,
        mediaIds: ids,
        limit
      })
    expect(await add(mediaIds.slice(0, 2), 2)).toMatchObject({
      status: 'added'
    })
    expect(
      await database.countGalleryAlbumStoredItems({
        albumId: created.album.id,
        actorId
      })
    ).toBe(2)

    // The media vanishes without the store's cleanup (SQLite runs without
    // foreign keys; PostgreSQL cascades, with the same result).
    await instance('attachments').where('mediaId', mediaIds[0]).delete()
    await instance('medias').where('id', mediaIds[0]).delete()

    expect(
      await database.countGalleryAlbumStoredItems({
        albumId: created.album.id,
        actorId
      })
    ).toBe(1)
    // The freed place can be used, though a row may still be left behind.
    expect(await add([mediaIds[2]], 2)).toMatchObject({
      status: 'added',
      added: [mediaIds[2]]
    })
  })

  it('removes the albums, their items and covers of the deleted actor', async () => {
    const username = `album-delete-${crypto.randomUUID().slice(0, 8)}`
    const actorId = `https://${TEST_DOMAIN}/users/${username}`
    await database.createAccount({
      email: `${username}@${TEST_DOMAIN}`,
      username,
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: `privateKey-${username}`,
      publicKey: `publicKey-${username}`
    })
    const statusId = `${actorId}/statuses/album-delete`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'album delete'
    })
    const mediaIds: string[] = []
    for (const name of ['one', 'two']) {
      const media = await database.createMedia({
        actorId,
        original: {
          path: `/test/album-delete-${name}.jpg`,
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: { width: 100, height: 100 }
        },
        details: { inGallery: true }
      })
      mediaIds.push(media!.id)
      await database.createAttachment({
        actorId,
        statusId,
        mediaType: 'image/jpeg',
        url: `https://media.test/album-delete-${name}.jpg`,
        width: 100,
        height: 100,
        mediaId: media!.id
      })
    }
    const created = await database.createGalleryAlbumWithinLimit({
      actorId,
      title: 'Doomed',
      limit: MAX_GALLERY_ALBUMS_PER_ACTOR
    })
    if (created.status !== 'created') throw new Error('not created')
    const added = await database.addGalleryAlbumItems({
      albumId: created.album.id,
      actorId,
      mediaIds,
      limit: MAX_GALLERY_ALBUM_ITEMS
    })
    expect(added).toMatchObject({ status: 'added', added: mediaIds })
    await database.updateGalleryAlbum({
      id: created.album.id,
      actorId,
      coverMediaId: mediaIds[0]
    })
    expect(await countRows('gallery_albums', actorId)).toBe(1)
    expect(await countRows('gallery_album_items', actorId)).toBe(2)

    await database.deleteActorData({ actorId })

    expect(await countRows('gallery_albums', actorId)).toBe(0)
    expect(await countRows('gallery_album_items', actorId)).toBe(0)
    expect(
      await instance('gallery_album_items').whereIn('mediaId', mediaIds)
    ).toEqual([])
  })
})
