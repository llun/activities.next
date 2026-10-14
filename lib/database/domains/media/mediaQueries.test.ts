import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { seedStatus } from '@/lib/database/testing/searchTestHelpers'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// The media reads (lib/database/domains/media/queries.ts) on both backends.
// Each where, join, order, limit and offset arm is pinned next to a row it
// must keep out or put in its place. Rows that tie on createdAt come in two
// groups, one inserted in id order and one in reverse, so dropping the id
// tie-break shows up whichever way the database breaks a tie; tied ids differ
// only in a digit, so they sort the same under C and en_US collation.
describe('media reads', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb

  const DOMAIN = 'media-reads.test'
  const actorIdOf = (username: string) => `https://${DOMAIN}/users/${username}`

  const ACCOUNT_A = 'account-a'
  const ACCOUNT_B = 'account-b'
  // Has a total-media counter and no media.
  const ACCOUNT_EMPTY = 'account-empty'
  // Account A has two actors; account B one; the loners none.
  const ownerA = actorIdOf('owner')
  const secondA = actorIdOf('second')
  const ownerB = actorIdOf('other')
  const loner = actorIdOf('loner')
  const secondLoner = actorIdOf('second-loner')
  // Attachments and media point at this actor, which has no row.
  const ghost = actorIdOf('ghost')

  const statusOf = (actorId: string, key: string | number) =>
    `${actorId}/statuses/${key}`

  const addActor = (id: string, accountId: string | null) =>
    db
      .insertInto('actors')
      .values({
        id,
        username: id.split('/').at(-1) ?? id,
        domain: DOMAIN,
        accountId,
        createdAt: new Date(1),
        updatedAt: new Date(1)
      })
      .execute()

  const addAttachment = ({
    id,
    actorId,
    statusId,
    createdAt,
    mediaId = null
  }: {
    id: string
    actorId: string | null
    statusId: string | null
    createdAt: number
    mediaId?: number | null
  }) =>
    db
      .insertInto('attachments')
      .values({
        id,
        actorId,
        statusId,
        type: 'Document',
        mediaType: 'image/jpeg',
        url: `https://${DOMAIN}/files/${encodeURIComponent(id)}.jpg`,
        width: 640,
        height: 480,
        name: '',
        mediaId,
        createdAt: new Date(createdAt),
        updatedAt: new Date(createdAt)
      })
      .execute()

  const addMedia = ({
    id,
    actorId,
    createdAt
  }: {
    id: number
    actorId: string | null
    createdAt: number
  }) =>
    db
      .insertInto('medias')
      .values({
        id,
        actorId,
        original: `medias/${id}.jpg`,
        originalBytes: 1000 + id,
        originalMimeType: 'image/jpeg',
        originalMetaData: JSON.stringify({ width: 640, height: 480 }),
        createdAt: new Date(createdAt),
        updatedAt: new Date(createdAt)
      })
      .execute()

  const setCounter = (id: string, value: number) =>
    db.insertInto('counters').values({ id, value }).execute()

  const idsOf = (items: { id: string }[]) => items.map((item) => item.id)

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()

    for (const accountId of [ACCOUNT_A, ACCOUNT_B, ACCOUNT_EMPTY]) {
      await db.insertInto('accounts').values({ id: accountId }).execute()
    }
    await addActor(ownerA, ACCOUNT_A)
    await addActor(secondA, ACCOUNT_A)
    await addActor(ownerB, ACCOUNT_B)
    await addActor(loner, null)
    await addActor(secondLoner, null)

    await setCounter(`total-media:${ACCOUNT_A}`, 42)
    await setCounter(`total-media:${ACCOUNT_B}`, 7)
    await setCounter(`total-media:${ACCOUNT_EMPTY}`, 3)
    await setCounter(`media-usage:${ACCOUNT_A}`, 12345)
  })

  afterAll(async () => {
    await database.destroy()
  })

  describe('getAttachments and getAttachmentsWithMedia', () => {
    const status = statusOf(ownerA, 'attachments')
    const neighbourStatus = statusOf(ownerA, 'neighbour')
    const attachmentOf = (key: string) => `${status}/attachments/${key}`

    beforeAll(async () => {
      // The latest has the lowest id, so ordering by id alone fails.
      await addAttachment({
        id: attachmentOf('1'),
        actorId: ownerA,
        statusId: status,
        createdAt: 3000,
        mediaId: 7
      })
      // Tied at 2000, inserted in id order.
      await addAttachment({
        id: attachmentOf('2'),
        actorId: ownerA,
        statusId: status,
        createdAt: 2000
      })
      await addAttachment({
        id: attachmentOf('3'),
        actorId: ownerA,
        statusId: status,
        createdAt: 2000
      })
      // Tied at 1000, inserted in reverse id order.
      await addAttachment({
        id: attachmentOf('5'),
        actorId: ownerA,
        statusId: status,
        createdAt: 1000
      })
      await addAttachment({
        id: attachmentOf('4'),
        actorId: ownerA,
        statusId: status,
        createdAt: 1000
      })
      // No actor: no reader can attribute it, so it is dropped.
      await addAttachment({
        id: attachmentOf('0'),
        actorId: null,
        statusId: status,
        createdAt: 1500
      })
      // Another status's attachment, between the others in time.
      await addAttachment({
        id: `${neighbourStatus}/attachments/1`,
        actorId: ownerA,
        statusId: neighbourStatus,
        createdAt: 2500
      })
      await db
        .updateTable('attachments')
        .set({
          blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
          focusX: 0.5,
          focusY: -0.25,
          thumbnailUrl: `https://${DOMAIN}/files/thumbnail.jpg`,
          playbackType: 'gifv'
        })
        .where('id', '=', attachmentOf('1'))
        .execute()
    })

    const expectedOrder = ['4', '5', '2', '3', '1'].map(attachmentOf)

    it('returns the status attachments by createdAt then id, skipping actorless rows', async () => {
      const attachments = await database.getAttachments({ statusId: status })
      expect(idsOf(attachments)).toEqual(expectedOrder)
    })

    it('maps a row to the domain attachment', async () => {
      const attachments = await database.getAttachments({ statusId: status })
      expect(attachments.at(-1)).toEqual({
        id: attachmentOf('1'),
        actorId: ownerA,
        statusId: status,
        type: 'Document',
        mediaType: 'image/jpeg',
        url: `https://${DOMAIN}/files/${encodeURIComponent(attachmentOf('1'))}.jpg`,
        width: 640,
        height: 480,
        name: '',
        mediaId: '7',
        blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
        focus: { x: 0.5, y: -0.25 },
        thumbnailUrl: `https://${DOMAIN}/files/thumbnail.jpg`,
        playbackType: 'gifv',
        createdAt: 3000,
        updatedAt: 3000
      })
      expect(attachments[0]).toEqual({
        id: attachmentOf('4'),
        actorId: ownerA,
        statusId: status,
        type: 'Document',
        mediaType: 'image/jpeg',
        url: `https://${DOMAIN}/files/${encodeURIComponent(attachmentOf('4'))}.jpg`,
        width: 640,
        height: 480,
        name: '',
        mediaId: null,
        createdAt: 1000,
        updatedAt: 1000
      })
    })

    it('returns nothing for a status without attachments', async () => {
      await expect(
        database.getAttachments({ statusId: statusOf(ownerA, 'none') })
      ).resolves.toEqual([])
    })

    it('getAttachmentsWithMedia returns the same rows with mediaId', async () => {
      const attachments = await database.getAttachmentsWithMedia({
        statusId: status
      })
      expect(idsOf(attachments)).toEqual(expectedOrder)
      expect(attachments.map((attachment) => attachment.mediaId)).toEqual([
        null,
        null,
        null,
        null,
        '7'
      ])
      expect(attachments).toEqual(
        await database.getAttachments({ statusId: status })
      )
    })
  })

  describe('getAttachmentsForActor', () => {
    const actorId = actorIdOf('gallery')
    const followersAudience = `https://${DOMAIN}/collections/gallery-followers`
    const viewer = actorIdOf('viewer')
    const publicStatus = statusOf(actorId, 'public')
    const followersStatus = statusOf(actorId, 'followers')
    const storedFollowersStatus = statusOf(actorId, 'stored-followers')
    const directStatus = statusOf(actorId, 'direct')
    const attachmentOf = (key: string) => `${actorId}/attachments/${key}`

    beforeAll(async () => {
      await addActor(actorId, null)
      await addActor(viewer, null)
      await seedStatus(db, {
        id: publicStatus,
        actorId,
        createdAt: 1,
        to: [ACTIVITY_STREAM_PUBLIC]
      })
      await seedStatus(db, {
        id: followersStatus,
        actorId,
        createdAt: 1,
        to: [`${actorId}/followers`]
      })
      await seedStatus(db, {
        id: storedFollowersStatus,
        actorId,
        createdAt: 1,
        to: [followersAudience]
      })
      await seedStatus(db, {
        id: directStatus,
        actorId,
        createdAt: 1,
        to: [viewer]
      })

      // Tied at 9000, inserted in id order.
      await addAttachment({
        id: attachmentOf('91'),
        actorId,
        statusId: publicStatus,
        createdAt: 9000
      })
      await addAttachment({
        id: attachmentOf('92'),
        actorId,
        statusId: publicStatus,
        createdAt: 9000
      })
      // Tied at 8000, inserted in reverse id order.
      await addAttachment({
        id: attachmentOf('82'),
        actorId,
        statusId: publicStatus,
        createdAt: 8000
      })
      await addAttachment({
        id: attachmentOf('81'),
        actorId,
        statusId: publicStatus,
        createdAt: 8000
      })
      // The earliest has the highest id, so ordering by id alone fails.
      await addAttachment({
        id: attachmentOf('99'),
        actorId,
        statusId: publicStatus,
        createdAt: 1000
      })
      await addAttachment({
        id: attachmentOf('70'),
        actorId,
        statusId: followersStatus,
        createdAt: 7000
      })
      await addAttachment({
        id: attachmentOf('60'),
        actorId,
        statusId: storedFollowersStatus,
        createdAt: 6000
      })
      await addAttachment({
        id: attachmentOf('50'),
        actorId,
        statusId: directStatus,
        createdAt: 5000
      })
      // Another actor's attachment on the gallery actor's public status.
      await addAttachment({
        id: `${viewer}/attachments/1`,
        actorId: viewer,
        statusId: publicStatus,
        createdAt: 8500
      })
    })

    const all = ['92', '91', '82', '81', '70', '60', '50', '99'].map(
      attachmentOf
    )
    const only = (keys: string[]) =>
      all.filter((id) => keys.some((key) => id === attachmentOf(key)))

    it('returns every attachment of the actor, newest first, with no audience', async () => {
      const attachments = await database.getAttachmentsForActor({ actorId })
      expect(idsOf(attachments)).toEqual(all)
    })

    it('keeps to the publicly readable statuses for publicOnly', async () => {
      const attachments = await database.getAttachmentsForActor({
        actorId,
        publicOnly: true
      })
      expect(idsOf(attachments)).toEqual(only(['92', '91', '82', '81', '99']))
    })

    it('adds the statuses addressed to the viewer', async () => {
      const attachments = await database.getAttachmentsForActor({
        actorId,
        visibleToActorId: viewer
      })
      expect(idsOf(attachments)).toEqual(
        only(['92', '91', '82', '81', '50', '99'])
      )
    })

    it('adds both followers collections for includeFollowersOnly', async () => {
      const attachments = await database.getAttachmentsForActor({
        actorId,
        includeFollowersOnly: true,
        followersAudience
      })
      expect(idsOf(attachments)).toEqual(
        only(['92', '91', '82', '81', '70', '60', '99'])
      )
    })

    it('returns only attachments strictly older than maxCreatedAt', async () => {
      const attachments = await database.getAttachmentsForActor({
        actorId,
        maxCreatedAt: 8000
      })
      expect(idsOf(attachments)).toEqual(only(['70', '60', '50', '99']))
    })

    it('treats a maxCreatedAt of 0 as no bound', async () => {
      const attachments = await database.getAttachmentsForActor({
        actorId,
        maxCreatedAt: 0
      })
      expect(idsOf(attachments)).toEqual(all)
    })

    it('applies the limit', async () => {
      const attachments = await database.getAttachmentsForActor({
        actorId,
        limit: 3
      })
      expect(idsOf(attachments)).toEqual(all.slice(0, 3))
    })

    it('reads a fractional limit as its integer part', async () => {
      const attachments = await database.getAttachmentsForActor({
        actorId,
        limit: 2.9
      })
      expect(idsOf(attachments)).toEqual(all.slice(0, 2))
    })

    it('drops a NaN limit', async () => {
      const attachments = await database.getAttachmentsForActor({
        actorId,
        limit: Number.NaN
      })
      expect(idsOf(attachments)).toEqual(all)
    })

    it('returns 25 by default', async () => {
      const busyActor = actorIdOf('busy')
      const busyStatus = statusOf(busyActor, 'busy')
      await addActor(busyActor, null)
      for (let index = 10; index < 36; index += 1) {
        await addAttachment({
          id: `${busyActor}/attachments/${index}`,
          actorId: busyActor,
          statusId: busyStatus,
          createdAt: index * 1000
        })
      }
      const attachments = await database.getAttachmentsForActor({
        actorId: busyActor
      })
      expect(attachments).toHaveLength(25)
      expect(attachments[0].id).toBe(`${busyActor}/attachments/35`)
      expect(attachments[24].id).toBe(`${busyActor}/attachments/11`)
    })
  })

  describe('getMediasWithStatusForAccount', () => {
    beforeAll(async () => {
      // The latest has the lowest id, so ordering by id alone fails.
      await addMedia({ id: 101, actorId: ownerA, createdAt: 9000 })
      // Tied at 8000, inserted in reverse id order.
      await addMedia({ id: 103, actorId: ownerA, createdAt: 8000 })
      await addMedia({ id: 102, actorId: ownerA, createdAt: 8000 })
      // Tied at 7000, inserted in id order.
      await addMedia({ id: 104, actorId: ownerA, createdAt: 7000 })
      await addMedia({ id: 105, actorId: ownerA, createdAt: 7000 })
      // The account's second actor, alone and tied with the first. SQLite
      // reads each actor's media through (actorId, createdAt) in rowid order,
      // which hides a missing id tie-break within one actor; across two
      // actors one of these pairs comes out wrong without it.
      await addMedia({ id: 106, actorId: secondA, createdAt: 6000 })
      await addMedia({ id: 107, actorId: ownerA, createdAt: 7500 })
      await addMedia({ id: 108, actorId: secondA, createdAt: 7500 })
      await addMedia({ id: 110, actorId: secondA, createdAt: 6500 })
      await addMedia({ id: 109, actorId: ownerA, createdAt: 6500 })
      // Not account A's: another account, no actor, an actor with no account.
      await addMedia({ id: 201, actorId: ownerB, createdAt: 8500 })
      await addMedia({ id: 202, actorId: null, createdAt: 9500 })
      await addMedia({ id: 203, actorId: loner, createdAt: 9500 })

      // 101: two of the account's own statuses (the lowest wins) and an
      // earlier-sorting one by another account.
      await addAttachment({
        id: 'media-101-a',
        actorId: ownerA,
        statusId: statusOf(ownerA, 2),
        createdAt: 1,
        mediaId: 101
      })
      await addAttachment({
        id: 'media-101-b',
        actorId: ownerA,
        statusId: statusOf(ownerA, 1),
        createdAt: 1,
        mediaId: 101
      })
      await addAttachment({
        id: 'media-101-c',
        actorId: ownerB,
        statusId: statusOf(ownerB, 0),
        createdAt: 1,
        mediaId: 101
      })
      // 103: attached by the account's second actor.
      await addAttachment({
        id: 'media-103-a',
        actorId: secondA,
        statusId: statusOf(secondA, 5),
        createdAt: 1,
        mediaId: 103
      })
      // 102: an empty and a null status id beside a real one.
      await addAttachment({
        id: 'media-102-a',
        actorId: ownerA,
        statusId: '',
        createdAt: 1,
        mediaId: 102
      })
      await addAttachment({
        id: 'media-102-b',
        actorId: ownerA,
        statusId: null,
        createdAt: 1,
        mediaId: 102
      })
      await addAttachment({
        id: 'media-102-c',
        actorId: ownerA,
        statusId: statusOf(ownerA, 3),
        createdAt: 1,
        mediaId: 102
      })
      // 105: attached only by another account.
      await addAttachment({
        id: 'media-105-a',
        actorId: ownerB,
        statusId: statusOf(ownerB, 4),
        createdAt: 1,
        mediaId: 105
      })
      // 104: only an empty status id.
      await addAttachment({
        id: 'media-104-a',
        actorId: ownerA,
        statusId: '',
        createdAt: 1,
        mediaId: 104
      })
      // 201 is account B's, attached by account A.
      await addAttachment({
        id: 'media-201-a',
        actorId: ownerA,
        statusId: statusOf(ownerA, 6),
        createdAt: 1,
        mediaId: 201
      })
    })

    const all = [
      '101',
      '103',
      '102',
      '108',
      '107',
      '105',
      '104',
      '110',
      '109',
      '106'
    ]

    it("returns the account's media of every actor, newest first, with the counter total", async () => {
      const { items, total } = await database.getMediasWithStatusForAccount({
        accountId: ACCOUNT_A
      })
      expect(idsOf(items)).toEqual(all)
      expect(total).toBe(42)
    })

    it('pairs each media with the lowest status id among the account attachments', async () => {
      const { items } = await database.getMediasWithStatusForAccount({
        accountId: ACCOUNT_A
      })
      expect(
        Object.fromEntries(
          items.map((item) => [item.id, item.statusId ?? null])
        )
      ).toEqual({
        '101': statusOf(ownerA, 1),
        '103': statusOf(secondA, 5),
        '102': statusOf(ownerA, 3),
        '108': null,
        '107': null,
        '105': null,
        '104': null,
        '110': null,
        '109': null,
        '106': null
      })
      expect(items.find((item) => item.id === '106')).not.toHaveProperty(
        'statusId'
      )
    })

    it('parses the media rows', async () => {
      const { items } = await database.getMediasWithStatusForAccount({
        accountId: ACCOUNT_A,
        limit: 1
      })
      expect(items[0]).toMatchObject({
        id: '101',
        actorId: ownerA,
        original: {
          path: 'medias/101.jpg',
          bytes: 1101,
          mimeType: 'image/jpeg',
          metaData: { width: 640, height: 480 }
        },
        statusId: statusOf(ownerA, 1)
      })
    })

    it("returns another account's media only to it", async () => {
      const { items, total } = await database.getMediasWithStatusForAccount({
        accountId: ACCOUNT_B
      })
      expect(idsOf(items)).toEqual(['201'])
      expect(items[0]).not.toHaveProperty('statusId')
      expect(total).toBe(7)
    })

    it('returns the counter total with no media', async () => {
      await expect(
        database.getMediasWithStatusForAccount({ accountId: ACCOUNT_EMPTY })
      ).resolves.toEqual({ items: [], total: 3 })
    })

    it('pages with limit and page', async () => {
      const page = (page: number) =>
        database
          .getMediasWithStatusForAccount({
            accountId: ACCOUNT_A,
            limit: 2,
            page
          })
          .then(({ items }) => idsOf(items))
      await expect(page(1)).resolves.toEqual(['101', '103'])
      await expect(page(2)).resolves.toEqual(['102', '108'])
      await expect(page(3)).resolves.toEqual(['107', '105'])
      await expect(page(4)).resolves.toEqual(['104', '110'])
      await expect(page(5)).resolves.toEqual(['109', '106'])
      await expect(page(6)).resolves.toEqual([])
    })

    it('returns only media strictly older than maxCreatedAt', async () => {
      const { items } = await database.getMediasWithStatusForAccount({
        accountId: ACCOUNT_A,
        maxCreatedAt: 8000
      })
      expect(idsOf(items)).toEqual([
        '108',
        '107',
        '105',
        '104',
        '110',
        '109',
        '106'
      ])
    })

    it('treats a maxCreatedAt of 0 as no bound', async () => {
      const { items } = await database.getMediasWithStatusForAccount({
        accountId: ACCOUNT_A,
        maxCreatedAt: 0
      })
      expect(idsOf(items)).toEqual(all)
    })

    it('reads the paging values through parseInt', async () => {
      const ids = (limit: number, page: number) =>
        database
          .getMediasWithStatusForAccount({ accountId: ACCOUNT_A, limit, page })
          .then(({ items }) => idsOf(items))
      // A fractional limit and offset keep their integer parts.
      await expect(ids(2.5, 2)).resolves.toEqual(['102', '108'])
      // A NaN page is no offset: the first page.
      await expect(ids(2, Number.NaN)).resolves.toEqual(['101', '103'])
      // A NaN limit is no limit, and so no offset either.
      await expect(ids(Number.NaN, 2)).resolves.toEqual(all)
    })

    it('rejects a page before the first', async () => {
      await expect(
        database.getMediasWithStatusForAccount({
          accountId: ACCOUNT_A,
          limit: 2,
          page: 0
        })
      ).rejects.toThrow('A non-negative integer must be provided to offset.')
    })
  })

  describe('getMediaByIdForAccount and getMediaByIdsForAccount', () => {
    beforeAll(async () => {
      await addMedia({ id: 301, actorId: ownerA, createdAt: 1000 })
      await addMedia({ id: 302, actorId: secondA, createdAt: 1000 })
      await addMedia({ id: 303, actorId: ownerB, createdAt: 1000 })
      await addMedia({ id: 304, actorId: loner, createdAt: 1000 })
    })

    it('returns a media of any actor of the account', async () => {
      await expect(
        database.getMediaByIdForAccount({
          mediaId: '301',
          accountId: ACCOUNT_A
        })
      ).resolves.toMatchObject({
        id: '301',
        actorId: ownerA,
        original: { path: 'medias/301.jpg', bytes: 1301 }
      })
      await expect(
        database.getMediaByIdForAccount({
          mediaId: '302',
          accountId: ACCOUNT_A
        })
      ).resolves.toMatchObject({ id: '302', actorId: secondA })
    })

    it("returns null for another account's media", async () => {
      await expect(
        database.getMediaByIdForAccount({
          mediaId: '303',
          accountId: ACCOUNT_A
        })
      ).resolves.toBeNull()
      await expect(
        database.getMediaByIdForAccount({
          mediaId: '303',
          accountId: ACCOUNT_B
        })
      ).resolves.toMatchObject({ id: '303' })
    })

    it('reads the id forms toMediaRowId admits', async () => {
      await expect(
        database.getMediaByIdForAccount({
          mediaId: '301.0',
          accountId: ACCOUNT_A
        })
      ).resolves.toMatchObject({ id: '301' })
    })

    it('returns null for a missing or malformed id', async () => {
      for (const mediaId of ['399', 'abc', '', '1.5', '-1']) {
        await expect(
          database.getMediaByIdForAccount({ mediaId, accountId: ACCOUNT_A })
        ).resolves.toBeNull()
      }
    })

    it("returns the listed media of the account's actors", async () => {
      const media = await database.getMediaByIdsForAccount({
        mediaIds: ['302', '303', '304', '301', '399', 'abc', ''],
        accountId: ACCOUNT_A
      })
      expect(idsOf(media).sort()).toEqual(['301', '302'])
      expect(media.find((item) => item.id === '302')).toMatchObject({
        actorId: secondA,
        original: { path: 'medias/302.jpg' }
      })
    })

    it('returns nothing for no usable ids', async () => {
      await expect(
        database.getMediaByIdsForAccount({ mediaIds: [], accountId: ACCOUNT_A })
      ).resolves.toEqual([])
      await expect(
        database.getMediaByIdsForAccount({
          mediaIds: ['abc', ''],
          accountId: ACCOUNT_A
        })
      ).resolves.toEqual([])
    })
  })

  describe('getMediaWithAttachedStatusIds', () => {
    beforeAll(async () => {
      await addMedia({ id: 401, actorId: ownerA, createdAt: 1000 })
      await addMedia({ id: 402, actorId: ownerA, createdAt: 1000 })
      await addMedia({ id: 403, actorId: loner, createdAt: 1000 })
      await addMedia({ id: 404, actorId: ghost, createdAt: 1000 })

      const attach = (
        id: string,
        actorId: string,
        statusId: string | null,
        mediaId: number
      ) => addAttachment({ id, actorId, statusId, createdAt: 1, mediaId })

      // 401: the owner (twice on one status), the owner's second actor,
      // another account, a loner, and the owner with no status.
      await attach('owned-401-a', ownerA, statusOf(ownerA, 41), 401)
      await attach('owned-401-b', ownerA, statusOf(ownerA, 41), 401)
      await attach('owned-401-c', secondA, statusOf(secondA, 42), 401)
      await attach('owned-401-d', ownerB, statusOf(ownerB, 43), 401)
      await attach('owned-401-e', loner, statusOf(loner, 44), 401)
      await attach('owned-401-f', ownerA, null, 401)
      await attach('owned-401-g', ownerA, '', 401)
      // 402: another media of the same owner.
      await attach('owned-402-a', ownerA, statusOf(ownerA, 45), 402)
      // 403: an owner with no account, and another actor with no account.
      await attach('owned-403-a', loner, statusOf(loner, 46), 403)
      await attach('owned-403-b', secondLoner, statusOf(secondLoner, 47), 403)
      // 404: the owner has no actor row.
      await attach('owned-404-a', ghost, statusOf(ghost, 48), 404)
    })

    it('returns the statuses the owner account attached the media to', async () => {
      const result = await database.getMediaWithAttachedStatusIds({
        mediaId: '401'
      })
      expect(result?.media).toMatchObject({
        id: '401',
        actorId: ownerA,
        original: { path: 'medias/401.jpg' }
      })
      expect([...(result?.statusIds ?? [])].sort()).toEqual([
        statusOf(ownerA, 41),
        statusOf(secondA, 42)
      ])
    })

    it("keeps to the media's own attachments", async () => {
      const result = await database.getMediaWithAttachedStatusIds({
        mediaId: '402'
      })
      expect(result?.media.id).toBe('402')
      expect(result?.statusIds).toEqual([statusOf(ownerA, 45)])
    })

    it('counts only the owner when the owner has no account', async () => {
      const result = await database.getMediaWithAttachedStatusIds({
        mediaId: '403'
      })
      expect(result?.statusIds).toEqual([statusOf(loner, 46)])
    })

    it('returns the media with no statuses when its owner has no actor row', async () => {
      const result = await database.getMediaWithAttachedStatusIds({
        mediaId: '404'
      })
      expect(result?.media).toMatchObject({ id: '404', actorId: ghost })
      expect(result?.statusIds).toEqual([])
    })

    it('returns null for a missing or malformed id', async () => {
      for (const mediaId of ['499', 'abc', '']) {
        await expect(
          database.getMediaWithAttachedStatusIds({ mediaId })
        ).resolves.toBeNull()
      }
    })
  })

  describe('getStorageUsageForAccount', () => {
    it("reads the account's media-usage counter", async () => {
      await expect(
        database.getStorageUsageForAccount({ accountId: ACCOUNT_A })
      ).resolves.toBe(12345)
    })

    it('is 0 without a counter', async () => {
      // Account B has a total-media counter but no media-usage one.
      await expect(
        database.getStorageUsageForAccount({ accountId: ACCOUNT_B })
      ).resolves.toBe(0)
    })
  })
})
