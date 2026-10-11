import { galleryMediaScope } from '@/lib/database/kysely/visibility/galleryMedia'
import { buildGalleryMediaScope } from '@/lib/database/sql/galleryAlbums'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { GalleryAudience } from '@/lib/services/gallery/galleryAudience'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

// The Kysely galleryMediaScope must select exactly the media its Knex twin
// buildGalleryMediaScope (lib/database/sql/galleryAlbums.ts, where the album
// reads still use it) selects. The Knex twin has the default options only (no
// `show`, `inGallery` required), so the Kysely one runs with those. Both run
// over the same rows, for the owner, a missing or unknown audience and every
// combination of the viewer flags, on a plain read of `medias` and on the
// album reads' join of `gallery_album_items` to `medias`; the id sets are
// compared, and the named cases say which arm broke.
describe('galleryMediaScope matches buildGalleryMediaScope', () => {
  const testDb = createTestDatabase()
  const { database, knex } = testDb

  const DOMAIN = 'gallery-scope.test'
  const actor = (name: string, domain = DOMAIN) =>
    `https://${domain}/users/${name}`
  const owner = actor('owner')
  const other = actor('other')
  const viewer = actor('viewer')
  const stranger = actor('stranger')
  // Has no rows at all.
  const ghost = actor('ghost', 'gone.test')
  const storedFollowers = `https://${DOMAIN}/collections/owner-followers`
  const ALBUM = 'album-1'

  const statusIds: Record<string, string> = {}
  const mediaIds: Record<string, number> = {}

  const note = async (
    key: string,
    {
      actorId = owner,
      to,
      cc = []
    }: { actorId?: string; to: string[]; cc?: string[] }
  ) => {
    const id = `${actorId}/statuses/${key}`
    await database.createNote({ id, url: id, actorId, text: key, to, cc })
    statusIds[key] = id
    return id
  }

  const media = async (
    key: string,
    {
      actorId = owner,
      inGallery = true,
      galleryAddedAt = null
    }: {
      actorId?: string
      inGallery?: boolean
      galleryAddedAt?: Date | null
    } = {}
  ) => {
    const row = await testDb.db
      .insertInto('medias')
      .values({
        actorId,
        original: `medias/${key}.jpg`,
        originalBytes: 1000,
        originalMimeType: 'image/jpeg',
        originalMetaData: JSON.stringify({ width: 10, height: 10 }),
        inGallery,
        galleryAddedAt,
        createdAt: new Date(1000),
        updatedAt: new Date(1000)
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    mediaIds[key] = row.id
    await testDb.db
      .insertInto('gallery_album_items')
      .values({
        albumId: ALBUM,
        mediaId: row.id,
        actorId,
        createdAt: new Date(1000)
      })
      .execute()
    return row.id
  }

  let attachmentCount = 0
  const attach = async (
    mediaKey: string,
    statusId: string | null,
    actorId = owner
  ) => {
    attachmentCount += 1
    await testDb.db
      .insertInto('attachments')
      .values({
        id: `attachment-${String(attachmentCount).padStart(3, '0')}`,
        actorId,
        statusId,
        type: 'Document',
        mediaType: 'image/jpeg',
        url: `https://${DOMAIN}/files/${mediaKey}.jpg`,
        name: '',
        mediaId: String(mediaIds[mediaKey]),
        createdAt: new Date(1000),
        updatedAt: new Date(1000)
      })
      .execute()
  }

  // Each scope as the reads use it: the media ids it selects.
  const selectedByKnex = async (
    actorId: string,
    audience: GalleryAudience,
    viaAlbum: boolean
  ) => {
    const query = viaAlbum
      ? knex('gallery_album_items as album_items')
          .innerJoin('medias', 'medias.id', 'album_items.mediaId')
          .where('album_items.albumId', ALBUM)
      : knex('medias')
    buildGalleryMediaScope(knex, actorId, audience)(query)
    const rows: { id: number | string }[] = await query.select('medias.id')
    return rows.map(({ id }) => Number(id)).sort((a, b) => a - b)
  }

  const selectedByKysely = async (
    actorId: string,
    audience: GalleryAudience,
    viaAlbum: boolean
  ) => {
    const db = testDb.db
    const rows = viaAlbum
      ? await db
          .selectFrom('gallery_album_items as album_items')
          .innerJoin('medias', 'medias.id', 'album_items.mediaId')
          .select('medias.id')
          .where('album_items.albumId', '=', ALBUM)
          .where(galleryMediaScope(db, actorId, audience))
          .execute()
      : await db
          .selectFrom('medias')
          .select('medias.id')
          .where(galleryMediaScope(db, actorId, audience))
          .execute()
    return rows.map(({ id }) => Number(id)).sort((a, b) => a - b)
  }

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()

    for (const id of [owner, other, viewer, stranger]) {
      const [, , domain, , username] = id.split('/')
      await database.createActor({
        actorId: id,
        username,
        domain,
        publicKey: `public-${username}`,
        privateKey: `private-${username}`,
        inboxUrl: `${id}/inbox`,
        sharedInboxUrl: `https://${domain}/inbox`,
        followersUrl: id === owner ? storedFollowers : `${id}/followers`,
        createdAt: Date.now()
      })
    }
    await testDb.db
      .insertInto('gallery_albums')
      .values({
        id: ALBUM,
        actorId: owner,
        title: 'Album',
        createdAt: new Date(1000),
        updatedAt: new Date(1000)
      })
      .execute()

    // The owner's posts, one per audience.
    await note('public', { to: [ACTIVITY_STREAM_PUBLIC] })
    await note('public-compact', { to: [ACTIVITY_STREAM_PUBLIC_COMPACT] })
    await note('unlisted', {
      to: [`${owner}/followers`],
      cc: [ACTIVITY_STREAM_PUBLIC]
    })
    await note('followers-fallback', { to: [`${owner}/followers`] })
    await note('followers-stored', { to: [storedFollowers] })
    await note('direct', { to: [viewer] })
    await note('direct-stranger', { to: [stranger] })
    await note('no-recipients', { to: [] })
    await note('deleted', { to: [ACTIVITY_STREAM_PUBLIC] })
    // Another actor's posts.
    await note('other-public', { actorId: other, to: [ACTIVITY_STREAM_PUBLIC] })
    await note('other-private', { actorId: other, to: [`${other}/followers`] })
    // The owner's public boost of the other actor's followers-only post: an
    // Announce is publicly readable only when its whole chain is.
    const boostId = `${owner}/statuses/boost-private`
    await database.createAnnounce({
      id: boostId,
      actorId: owner,
      originalStatusId: statusIds['other-private'],
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    statusIds['boost-private'] = boostId

    // One media per status the owner posted it on.
    for (const key of [
      'public',
      'public-compact',
      'unlisted',
      'followers-fallback',
      'followers-stored',
      'direct',
      'direct-stranger',
      'no-recipients',
      'boost-private'
    ]) {
      await media(key)
      await attach(key, statusIds[key])
    }
    // The gallery switch off, on a public post.
    await media('hidden')
    await testDb.db
      .updateTable('medias')
      .set({ inGallery: false })
      .where('id', '=', mediaIds.hidden)
      .execute()
    await attach('hidden', statusIds.public)
    // Added in Gallery and not posted, with the switch on and off.
    await media('added', { galleryAddedAt: new Date(2000) })
    await media('added-hidden', {
      inGallery: false,
      galleryAddedAt: new Date(2000)
    })
    // Posted publicly and added in Gallery.
    await media('posted-and-added', { galleryAddedAt: new Date(2000) })
    await attach('posted-and-added', statusIds.public)
    // An upload nobody kept.
    await media('unposted')
    // The status row is gone; its attachment is left behind.
    await media('deleted-post')
    await attach('deleted-post', statusIds.deleted)
    await testDb.db
      .deleteFrom('statuses')
      .where('id', '=', statusIds.deleted)
      .execute()
    // Another actor's public post points at the owner's media.
    await media('foreign-attachment')
    await attach('foreign-attachment', statusIds['other-public'], other)
    // The owner's attachment on another actor's public post.
    await media('owner-attachment-on-other-status')
    await attach('owner-attachment-on-other-status', statusIds['other-public'])
    // Attachments with no status.
    await media('no-status')
    await attach('no-status', null)
    await media('empty-status')
    await attach('empty-status', '')
    // The other actor's own posted gallery media.
    await media('other-media', { actorId: other })
    await attach('other-media', statusIds['other-public'], other)
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  const viewerAudience = (
    flags: Partial<Extract<GalleryAudience, { kind: 'viewer' }>>
  ): GalleryAudience => ({
    kind: 'viewer',
    publicOnly: false,
    visibleToActorId: null,
    includeFollowersOnly: false,
    followersAudience: null,
    ...flags
  })

  const audiences: GalleryAudience[] = [
    { kind: 'owner' },
    // A missing or unknown audience fails closed, as the public view.
    null as unknown as GalleryAudience,
    undefined as unknown as GalleryAudience,
    { kind: 'unknown' } as unknown as GalleryAudience
  ]
  for (const publicOnly of [false, true]) {
    for (const visibleToActorId of [null, '', viewer, stranger, owner]) {
      for (const includeFollowersOnly of [false, true]) {
        for (const followersAudience of [
          null,
          '',
          storedFollowers,
          `${owner}/followers`
        ]) {
          audiences.push(
            viewerAudience({
              publicOnly,
              visibleToActorId,
              includeFollowersOnly,
              followersAudience
            })
          )
        }
      }
    }
  }

  it.each([
    { name: 'owner', actorId: owner, viaAlbum: false },
    { name: 'owner', actorId: owner, viaAlbum: true },
    { name: 'other', actorId: other, viaAlbum: false },
    { name: 'ghost', actorId: ghost, viaAlbum: false }
  ])(
    'selects the same media as the Knex scope for every audience of $name (album join: $viaAlbum)',
    async ({ actorId, viaAlbum }) => {
      let selectedAny = 0
      for (const audience of audiences) {
        const [knexIds, kyselyIds] = await Promise.all([
          selectedByKnex(actorId, audience, viaAlbum),
          selectedByKysely(actorId, audience, viaAlbum)
        ])
        expect({ audience, ids: kyselyIds }).toEqual({
          audience,
          ids: knexIds
        })
        if (knexIds.length > 0) selectedAny += 1
      }
      // The comparison is not vacuous: for the owner every audience sees at
      // least the public post's media.
      if (actorId === owner) expect(selectedAny).toBe(audiences.length)
    }
  )

  const keysOf = (ids: number[]) =>
    Object.entries(mediaIds)
      .filter(([, id]) => ids.includes(id))
      .map(([key]) => key)
      .sort()

  // The arms by name, so a failure says which one broke.
  it.each([
    {
      name: 'owner',
      audience: { kind: 'owner' } as GalleryAudience,
      expected: [
        'added',
        'boost-private',
        'direct',
        'direct-stranger',
        'followers-fallback',
        'followers-stored',
        'no-recipients',
        'posted-and-added',
        'public',
        'public-compact',
        'unlisted'
      ]
    },
    {
      name: 'logged out',
      audience: viewerAudience({ publicOnly: true }),
      expected: ['posted-and-added', 'public', 'public-compact', 'unlisted']
    },
    {
      name: 'viewer with no flags (coerced to logged out)',
      audience: viewerAudience({}),
      expected: ['posted-and-added', 'public', 'public-compact', 'unlisted']
    },
    {
      name: 'mentioned viewer',
      audience: viewerAudience({ visibleToActorId: viewer }),
      expected: [
        'boost-private',
        'direct',
        'posted-and-added',
        'public',
        'public-compact',
        'unlisted'
      ]
    },
    {
      name: 'follower',
      audience: viewerAudience({
        visibleToActorId: stranger,
        includeFollowersOnly: true,
        followersAudience: storedFollowers
      }),
      expected: [
        'boost-private',
        'direct-stranger',
        'followers-fallback',
        'followers-stored',
        'posted-and-added',
        'public',
        'public-compact',
        'unlisted'
      ]
    }
  ])(
    'selects the expected media for the $name',
    async ({ audience, expected }) => {
      const [knexIds, kyselyIds] = await Promise.all([
        selectedByKnex(owner, audience, false),
        selectedByKysely(owner, audience, false)
      ])
      expect(keysOf(kyselyIds)).toEqual(expected)
      expect(keysOf(knexIds)).toEqual(expected)
    }
  )
})
