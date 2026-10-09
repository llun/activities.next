import { afterAll, beforeAll } from 'vitest'

import type { GalleryAlbumCursor } from '@/lib/database/sql/galleryAlbums'
import { Database } from '@/lib/database/types'
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
  MAX_GALLERY_ALBUMS_PER_ACTOR
} from '@/lib/types/database/galleryAlbums'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// Seeds one gallery fixture (photos, posts and helpers) into `database` and
// destroys the database afterwards. Call it inside a describe so its hooks
// attach to that suite.
export const useGalleryAlbumsFixture = (database: Database) => {
  const { actors } = DatabaseSeed
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
    await post('foreign', 'foreign', [ACTIVITY_STREAM_PUBLIC], [], otherActorId)
  })

  afterAll(async () => {
    await database.destroy()
  })

  const uniqueTitle = () => {
    counter += 1
    return `Album ${counter}`
  }
  return {
    ownerId,
    followersUrl,
    strangerId,
    mentionedId,
    otherActorId,
    audiences,
    ids,
    statusId,
    createMedia,
    post,
    addPhoto,
    namesOf,
    createAlbum,
    addItems,
    mediaOf,
    namesIn,
    uniqueTitle,
    getOwnerAccountId: () => ownerAccountId
  }
}
