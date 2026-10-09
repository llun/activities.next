import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('GalleryAlbumSuggestionDatabase', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    const ownerId: string = actors.empty.id
    const otherId: string = actors.extra.id
    const emptyOwnerId: string = actors.pollAuthor.id
    const ids: Record<string, string> = {}
    let ownerAlbum = ''
    let otherAlbum = ''

    const post = async (name: string, actorId: string) => {
      const media = await database.createMedia({
        actorId,
        original: {
          path: `/test/item-sets-${name}.jpg`,
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: { width: 100, height: 100 }
        },
        details: { inGallery: true }
      })
      ids[name] = media!.id
      const statusId = `${actorId}/statuses/item-sets-${name}`
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
        url: `https://media.test/item-sets-${name}.jpg`,
        width: 100,
        height: 100,
        mediaId: media!.id
      })
    }

    beforeAll(async () => {
      await seedDatabase(database)
      for (const name of ['a', 'b', 'c']) await post(name, ownerId)
      await post('x', otherId)

      const first = await database.createGalleryAlbumWithinLimit({
        actorId: ownerId,
        title: 'Mine',
        limit: 200,
        mediaIds: [ids.a, ids.b]
      })
      const second = await database.createGalleryAlbumWithinLimit({
        actorId: ownerId,
        title: 'Also mine',
        limit: 200,
        mediaIds: [ids.b, ids.c]
      })
      // An album with no item.
      await database.createGalleryAlbumWithinLimit({
        actorId: ownerId,
        title: 'Empty',
        limit: 200
      })
      const other = await database.createGalleryAlbumWithinLimit({
        actorId: otherId,
        title: 'Theirs',
        limit: 200,
        mediaIds: [ids.x]
      })
      if (
        first.status !== 'created' ||
        second.status !== 'created' ||
        other.status !== 'created'
      ) {
        throw new Error('albums not created')
      }
      ownerAlbum = first.album.id
      otherAlbum = other.album.id
      expect(second.album.id).not.toBe(ownerAlbum)
    })

    afterAll(async () => {
      await database.destroy()
    })

    it('lists each of the actor’s albums with the media ids of its items, and leaves out empty albums', async () => {
      const sets = await database.getGalleryAlbumItemSets({
        actorId: ownerId,
        mediaIds: [ids.a, ids.b, ids.c]
      })

      expect(sets).toHaveLength(2)
      expect(sets.map((set) => [...set.mediaIds].sort()).sort()).toEqual(
        [[ids.a, ids.b].sort(), [ids.b, ids.c].sort()].sort()
      )
      expect(
        sets.find((set) => set.albumId === ownerAlbum)?.mediaIds.sort()
      ).toEqual([ids.a, ids.b].sort())
      expect(
        sets.every((set) => set.mediaIds.every((id) => typeof id === 'string'))
      ).toBeTrue()
    })

    it('never returns another actor’s album', async () => {
      const sets = await database.getGalleryAlbumItemSets({
        actorId: otherId,
        mediaIds: [ids.x]
      })

      expect(sets).toEqual([{ albumId: otherAlbum, mediaIds: [ids.x] }])
    })

    it('does not list the items of the actor’s albums for media ids somebody else asks with', async () => {
      // The owner's photos asked for as the other actor: that actor holds none.
      expect(
        await database.getGalleryAlbumItemSets({
          actorId: otherId,
          mediaIds: [ids.a, ids.b, ids.c]
        })
      ).toEqual([])
    })

    it('reads only the asked media ids, and leaves out an album holding none of them', async () => {
      const sets = await database.getGalleryAlbumItemSets({
        actorId: ownerId,
        mediaIds: [ids.a]
      })
      expect(sets).toEqual([{ albumId: ownerAlbum, mediaIds: [ids.a] }])

      expect(
        await database.getGalleryAlbumItemSets({
          actorId: ownerId,
          mediaIds: [ids.x]
        })
      ).toEqual([])
    })

    it('reads nothing, without a query, for no media ids or ids that are not numbers', async () => {
      expect(
        await database.getGalleryAlbumItemSets({
          actorId: ownerId,
          mediaIds: []
        })
      ).toEqual([])
      expect(
        await database.getGalleryAlbumItemSets({
          actorId: ownerId,
          mediaIds: ['', 'abc', '1; drop table medias', '-1']
        })
      ).toEqual([])
    })

    it('asks in batches, so thousands of ids stay under the binding limit', async () => {
      const many = Array.from({ length: 3000 }, (_, index) =>
        String(900_000 + index)
      )
      const sets = await database.getGalleryAlbumItemSets({
        actorId: ownerId,
        mediaIds: [...many.slice(0, 1500), ids.b, ...many.slice(1500)]
      })

      expect(sets).toHaveLength(2)
      expect(sets.find((set) => set.albumId === ownerAlbum)?.mediaIds).toEqual([
        ids.b
      ])
    })

    it('returns nothing for an actor with no albums', async () => {
      expect(
        await database.getGalleryAlbumItemSets({
          actorId: emptyOwnerId,
          mediaIds: [ids.a]
        })
      ).toEqual([])
    })

    it('still lists an item whose post is gone, because the album holds it', async () => {
      // An actor of its own, so no other test sees this album.
      const goneOwnerId: string = actors.replyAuthor.id
      await post('gone', goneOwnerId)
      const album = await database.createGalleryAlbumWithinLimit({
        actorId: goneOwnerId,
        title: 'Has a gone photo',
        limit: 200,
        mediaIds: [ids.gone]
      })
      if (album.status !== 'created') throw new Error('album not created')
      await database.deleteStatus({
        statusId: `${goneOwnerId}/statuses/item-sets-gone`
      })

      expect(
        await database.getGalleryAlbumItemSets({
          actorId: goneOwnerId,
          mediaIds: [ids.gone]
        })
      ).toEqual([{ albumId: album.album.id, mediaIds: [ids.gone] }])
    })
  })
})
