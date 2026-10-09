import { useGalleryAlbumsFixture } from '@/lib/database/sql/galleryAlbumsTestFixture'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import {
  GalleryAudience,
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
      strangerId,
      otherActorId,
      audiences,
      ids,
      statusId,
      createMedia,
      post,
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

      it('reads the public rows of a private album when asked, for its owner preview', async () => {
        const secret = await createAlbum(uniqueTitle(), {
          visibility: 'private'
        })
        await addItems(secret.id, ['public', 'followers'])
        const read = (actorId: string, ignoreAlbumVisibility?: boolean) =>
          database.getGalleryAlbumIndex({
            albumId: secret.id,
            actorId,
            audience: PUBLIC_GALLERY_AUDIENCE,
            ignoreAlbumVisibility
          })

        // Closed to a visitor by default.
        expect(await read(ownerId)).toEqual([])
        // Asked to ignore the album's own gate: still only the photos the
        // public audience may see, never the followers-only one.
        expect(
          namesOf((await read(ownerId, true)).map((row) => row.id))
        ).toEqual(['public'])
        // And never another account's album.
        expect(await read(otherActorId, true)).toEqual([])
      })

      it('lists only public albums with something visible to a visitor', async () => {
        // Its own account with its own photos and albums, so the exact titles
        // below do not depend on any other test.
        const actorId = actors.followRequester.id
        const stranger: GalleryAudience = {
          kind: 'viewer',
          publicOnly: false,
          visibleToActorId: strangerId,
          includeFollowersOnly: false,
          followersAudience: `${actorId}/followers`
        }
        for (const [name, to] of [
          ['list-open', [ACTIVITY_STREAM_PUBLIC]],
          ['list-followers', [`${actorId}/followers`]]
        ] as const) {
          await createMedia(name, {}, actorId)
          await post(name, name, [...to], [], actorId)
        }
        const add = (albumId: string, name: string) =>
          database.addGalleryAlbumItems({
            albumId,
            actorId,
            mediaIds: [ids[name]],
            limit: MAX_GALLERY_ALBUM_ITEMS
          })

        const open = await createAlbum('List open', { actorId })
        await add(open.id, 'list-open')
        const secret = await createAlbum('List private', {
          actorId,
          visibility: 'private'
        })
        await add(secret.id, 'list-open')
        const followersOnly = await createAlbum('List followers', { actorId })
        await add(followersOnly.id, 'list-followers')
        await createAlbum('List empty', { actorId })

        const titlesFor = async (audience: GalleryAudience) =>
          (await database.getGalleryAlbumSummaries({ actorId, audience })).map(
            (summary) => summary.album.title
          )

        const owner = await titlesFor(OWNER_GALLERY_AUDIENCE)
        expect([...owner].sort()).toEqual([
          'List empty',
          'List followers',
          'List open',
          'List private'
        ])
        // A visitor: public, with a photo they may see. Not the private
        // album, not the empty one, not the one holding only a followers-only
        // post.
        expect(await titlesFor(stranger)).toEqual(['List open'])
        expect(await titlesFor(PUBLIC_GALLERY_AUDIENCE)).toEqual(['List open'])
      })

      it("breaks a tie between visitor albums on the id, whatever the owner's stored order is", async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
          vi.setSystemTime(Date.UTC(2028, 0, 1))
          const first = await createAlbum(uniqueTitle())
          const second = await createAlbum(uniqueTitle())
          const [low, high] =
            first.id < second.id ? [first, second] : [second, first]

          // The same visible photo joins both in the same millisecond, so a
          // visitor sees the same time on both.
          await addItems(low.id, ['public'])
          await addItems(high.id, ['public'])
          // A photo only the owner can see then moves the higher id's stored
          // time on, so the owner's order puts it first. The visitor's
          // must not follow.
          vi.setSystemTime(Date.UTC(2028, 0, 2))
          await addItems(high.id, ['direct'])

          const order = async (audience: GalleryAudience) =>
            (
              await database.getGalleryAlbumSummaries({
                actorId: ownerId,
                audience
              })
            )
              .map((summary) => summary.album.id)
              .filter((id) => id === low.id || id === high.id)

          expect(await order(OWNER_GALLERY_AUDIENCE)).toEqual([high.id, low.id])
          expect(await order(PUBLIC_GALLERY_AUDIENCE)).toEqual([
            low.id,
            high.id
          ])
          expect(await order(audiences.stranger)).toEqual([low.id, high.id])
        } finally {
          vi.useRealTimers()
        }
      })

      it('moves an album to the top when photos are added to or removed from it', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
          vi.setSystemTime(Date.UTC(2027, 0, 1))
          const older = await createAlbum(uniqueTitle())
          vi.setSystemTime(Date.UTC(2027, 0, 2))
          const newer = await createAlbum(uniqueTitle())
          const order = async () =>
            (
              await database.getGalleryAlbumSummaries({
                actorId: ownerId,
                audience: OWNER_GALLERY_AUDIENCE
              })
            )
              .map((summary) => summary.album.id)
              .filter((id) => id === older.id || id === newer.id)

          expect(await order()).toEqual([newer.id, older.id])

          vi.setSystemTime(Date.UTC(2027, 0, 3))
          await addItems(older.id, ['public'])
          expect(await order()).toEqual([older.id, newer.id])

          vi.setSystemTime(Date.UTC(2027, 0, 4))
          await addItems(newer.id, ['public'])
          expect(await order()).toEqual([newer.id, older.id])

          vi.setSystemTime(Date.UTC(2027, 0, 5))
          await database.removeGalleryAlbumItems({
            albumId: older.id,
            actorId: ownerId,
            mediaIds: [ids.public]
          })
          expect(await order()).toEqual([older.id, newer.id])
        } finally {
          vi.useRealTimers()
        }
      })
    })

    describe('countGalleryAlbumMedia', () => {
      it('counts distinct visible media across albums, public albums only for a visitor', async () => {
        // Its own account, so the count starts from nothing.
        const actorId = actors.extra.id
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

    describe('getActorHasVisibleGalleryAlbums', () => {
      // A fresh account each time, so what an album's owner "has" starts from
      // nothing and no other test's albums count.
      const createOwner = async (tag: string) => {
        const username = `album-has-${tag}-${crypto.randomUUID().slice(0, 8)}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${username}`,
          publicKey: `publicKey-${username}`
        })
        return actorId
      }
      const viewer = (
        actorId: string,
        overrides: Partial<Extract<GalleryAudience, { kind: 'viewer' }>> = {}
      ): GalleryAudience => ({
        kind: 'viewer',
        publicOnly: false,
        visibleToActorId: strangerId,
        includeFollowersOnly: false,
        followersAudience: `${actorId}/followers`,
        ...overrides
      })
      const has = (actorId: string, audience: GalleryAudience) =>
        database.getActorHasVisibleGalleryAlbums({ actorId, audience })
      const albumWith = async (
        actorId: string,
        name: string,
        to: string[],
        visibility: 'public' | 'private' = 'public'
      ) => {
        await createMedia(name, {}, actorId)
        await post(name, name, to, [], actorId)
        const created = await database.createGalleryAlbumWithinLimit({
          actorId,
          title: name,
          visibility,
          limit: MAX_GALLERY_ALBUMS_PER_ACTOR
        })
        if (created.status !== 'created') throw new Error('not created')
        await database.addGalleryAlbumItems({
          albumId: created.album.id,
          actorId,
          mediaIds: [ids[name]],
          limit: MAX_GALLERY_ALBUM_ITEMS
        })
        return created.album.id
      }

      it('is false for everyone when the actor has no albums', async () => {
        const actorId = await createOwner('none')
        for (const audience of [
          OWNER_GALLERY_AUDIENCE,
          PUBLIC_GALLERY_AUDIENCE,
          viewer(actorId)
        ]) {
          expect(await has(actorId, audience)).toBe(false)
        }
      })

      it('lets the owner see any album of theirs, even an empty or private one', async () => {
        const actorId = await createOwner('owner')
        await database.createGalleryAlbumWithinLimit({
          actorId,
          title: 'Empty',
          limit: MAX_GALLERY_ALBUMS_PER_ACTOR
        })
        expect(await has(actorId, OWNER_GALLERY_AUDIENCE)).toBe(true)
        // Nothing in it for anyone else.
        expect(await has(actorId, PUBLIC_GALLERY_AUDIENCE)).toBe(false)
        expect(await has(actorId, viewer(actorId))).toBe(false)
      })

      it('needs a public album with a photo the visitor may see', async () => {
        const actorId = await createOwner('public')
        await albumWith(
          actorId,
          'has-secret',
          [ACTIVITY_STREAM_PUBLIC],
          'private'
        )
        // A private album does not count, however public its photos.
        expect(await has(actorId, PUBLIC_GALLERY_AUDIENCE)).toBe(false)
        expect(await has(actorId, viewer(actorId))).toBe(false)

        await albumWith(actorId, 'has-open', [ACTIVITY_STREAM_PUBLIC])
        expect(await has(actorId, PUBLIC_GALLERY_AUDIENCE)).toBe(true)
        expect(await has(actorId, viewer(actorId))).toBe(true)
        // A viewer whose flags are all falsy fails closed to the logged-out
        // view, which can still see this one.
        expect(
          await has(
            actorId,
            viewer(actorId, { visibleToActorId: null, followersAudience: null })
          )
        ).toBe(true)
      })

      it('counts an album whose only photo is followers-only for a follower alone', async () => {
        const actorId = await createOwner('followers')
        await albumWith(actorId, 'has-followers', [`${actorId}/followers`])

        expect(await has(actorId, PUBLIC_GALLERY_AUDIENCE)).toBe(false)
        expect(await has(actorId, viewer(actorId))).toBe(false)
        expect(
          await has(actorId, viewer(actorId, { includeFollowersOnly: true }))
        ).toBe(true)
        expect(await has(actorId, OWNER_GALLERY_AUDIENCE)).toBe(true)
      })

      it('stops counting an album once its only photo is no longer visible', async () => {
        const actorId = await createOwner('gone')
        await albumWith(actorId, 'has-gone', [ACTIVITY_STREAM_PUBLIC])
        expect(await has(actorId, PUBLIC_GALLERY_AUDIENCE)).toBe(true)

        // Taken out of the gallery.
        const owner = await database.getActorFromId({ id: actorId })
        await database.updateMedia({
          mediaId: ids['has-gone'],
          accountId: owner!.account!.id,
          details: { inGallery: false }
        })
        expect(await has(actorId, PUBLIC_GALLERY_AUDIENCE)).toBe(false)
        await database.updateMedia({
          mediaId: ids['has-gone'],
          accountId: owner!.account!.id,
          details: { inGallery: true }
        })
        expect(await has(actorId, PUBLIC_GALLERY_AUDIENCE)).toBe(true)

        // Its post deleted.
        await database.deleteStatus({ statusId: statusId('has-gone', actorId) })
        expect(await has(actorId, PUBLIC_GALLERY_AUDIENCE)).toBe(false)
        expect(await has(actorId, OWNER_GALLERY_AUDIENCE)).toBe(true)
      })
    })
  })
})
