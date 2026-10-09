import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { ACTOR5_ID } from '@/lib/stub/seed/actor5'
import { ACTOR6_ID, seedActor6 } from '@/lib/stub/seed/actor6'
import { MediaDetailsRecord } from '@/lib/types/database/gallery'
import { MAX_GALLERY_ALBUMS_PER_ACTOR } from '@/lib/types/database/galleryAlbums'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

/**
 * The album owner of the visibility matrix: a seeded account with no posts,
 * follows or followers of its own, so every count a test reads is the matrix's.
 */
export const MATRIX_OWNER_ID = ACTOR6_ID
export const MATRIX_OWNER_EMAIL = seedActor6.email

export interface GalleryAlbumMatrix {
  ownerId: string
  /** Every photo's media id, by name. */
  media: Record<string, string>
  /** Every album's id, by name. */
  albums: {
    /** Public. Six photos, one per row of the post matrix (see below). */
    mixed: string
    /** Public. Only a followers-only photo. */
    followersOnly: string
    /** Public. Only a direct-message photo. */
    directOnly: string
    /** Public. Only photos nobody can see: a deleted post, one not in the gallery. */
    goneOnly: string
    /** Private. Holds a public photo. */
    secret: string
    /** Public. No photos at all. */
    empty: string
    /** Public. One photo for each place rule. */
    places: string
  }
  /** The accounts that look at the gallery, as the actors a session resolves to. */
  viewers: {
    // Follows the owner (accepted).
    follower: Actor
    // Signed in, no relationship.
    stranger: Actor
    // Followed once, then the owner blocked them (a block undoes the follow).
    blocked: Actor
  }
}

const day = (month: number, date: number) => Date.UTC(2026, month - 1, date, 12)

/**
 * Seeds the visibility matrix of the album visitor tests: one owner, three
 * kinds of signed-in viewer, one photo per post visibility (public, unlisted,
 * followers only, direct), a deleted post, a photo not in the gallery, and one
 * photo for each rule that withholds a place.
 *
 * `mixed` holds, in taken-at order:
 *   public (Jan 10), unlisted (Feb 10), followers (Mar 10), direct (Apr 10),
 *   deleted (May 10), hidden (Jun 10; `inGallery` is false)
 * with the followers-only photo chosen as its cover, so a cover that a viewer
 * may not see has to fall back.
 *
 * Seeds the standard database first, so call it once per database.
 */
export const seedGalleryAlbumMatrix = async (
  database: Database
): Promise<GalleryAlbumMatrix> => {
  await seedDatabase(database)

  const ownerId = MATRIX_OWNER_ID
  const followersUrl = `${ownerId}/followers`
  const media: Record<string, string> = {}

  const addPhoto = async (
    name: string,
    to: string[],
    cc: string[],
    details: Partial<MediaDetailsRecord>,
    options: {
      lookup?: { status: 'resolved' | 'pending' | 'failed'; iucn?: 'CR' | 'LC' }
      // What the place lookup writes, which `createMedia` cannot set.
      place?: { countryCode: string; name?: string }
    } = {}
  ) => {
    const created = await database.createMedia({
      actorId: ownerId,
      original: {
        path: `/test/matrix-${name}.jpg`,
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 400, height: 300 }
      },
      details: { inGallery: true, ...details }
    })
    media[name] = created!.id
    if (options.lookup) {
      await database.setMediaSubjectLookup({
        mediaId: created!.id,
        expect: {
          subjectName: details.subjectName ?? null,
          subjectScientificName: details.subjectScientificName ?? null,
          subjectTaxonKey: null
        },
        patch: {
          subjectLookupStatus: options.lookup.status,
          subjectIucnCategory: options.lookup.iucn ?? null
        }
      })
    }
    if (options.place) {
      await database.setMediaPlaceLookup({
        mediaId: created!.id,
        expect: {
          placeLatitude: details.placeLatitude ?? null,
          placeLongitude: details.placeLongitude ?? null
        },
        patch: {
          placeLookupStatus: 'resolved',
          placeCountryCode: options.place.countryCode,
          ...(options.place.name ? { placeName: options.place.name } : {})
        }
      })
    }
    const statusId = `${ownerId}/statuses/matrix-${name}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ownerId,
      to,
      cc,
      text: name
    })
    await database.createAttachment({
      actorId: ownerId,
      statusId,
      mediaType: 'image/jpeg',
      url: `https://media.test/matrix-${name}.jpg`,
      width: 400,
      height: 300,
      mediaId: created!.id
    })
    return statusId
  }

  const lc = { status: 'resolved', iucn: 'LC' } as const
  const publicTo = [ACTIVITY_STREAM_PUBLIC]

  // The post matrix.
  await addPhoto(
    'public',
    publicTo,
    [],
    {
      subjectName: 'Common Kingfisher',
      subjectScientificName: 'Alcedo atthis',
      subjectCategory: 'bird',
      takenAt: day(1, 10),
      placeName: 'River',
      placeLatitude: 51.5543,
      placeLongitude: -0.0231,
      placePrecision: 'exact',
      placeNameSource: 'owner'
    },
    { lookup: lc, place: { countryCode: 'GB' } }
  )
  await addPhoto('unlisted', [followersUrl], [ACTIVITY_STREAM_PUBLIC], {
    subjectName: 'Red Fox',
    subjectCategory: 'mammal',
    takenAt: day(2, 10)
  })
  await addPhoto(
    'followers',
    [followersUrl],
    [],
    {
      subjectName: 'Grey Heron',
      subjectScientificName: 'Ardea cinerea',
      subjectCategory: 'bird',
      takenAt: day(3, 10),
      placeName: 'Marsh',
      placeLatitude: 20,
      placeLongitude: 20,
      placePrecision: 'exact',
      placeNameSource: 'owner'
    },
    { lookup: lc, place: { countryCode: 'NL' } }
  )
  // Direct to an account that is none of the viewers.
  await addPhoto('direct', [ACTOR5_ID], [], {
    subjectName: 'Barn Owl',
    subjectCategory: 'bird',
    takenAt: day(4, 10)
  })
  const deletedStatus = await addPhoto('deleted', publicTo, [], {
    subjectName: 'Otter',
    subjectCategory: 'mammal',
    takenAt: day(5, 10)
  })
  await database.deleteStatus({ statusId: deletedStatus })
  await addPhoto('hidden', publicTo, [], {
    inGallery: false,
    subjectName: 'Badger',
    subjectCategory: 'mammal',
    takenAt: day(6, 10)
  })

  // The place matrix, all on public posts so the post rules stay out of it.
  const placed = (
    name: string,
    subject: string,
    scientific: string | null,
    when: number,
    place: Partial<MediaDetailsRecord>
  ): [string, string[], string[], Partial<MediaDetailsRecord>] => [
    name,
    publicTo,
    [],
    {
      subjectName: subject,
      subjectScientificName: scientific,
      subjectCategory: scientific ? 'mammal' : 'landscape',
      takenAt: day(9, when),
      ...place
    }
  ]
  await addPhoto(
    ...placed('place-exact', 'Leopard', 'Panthera pardus', 1, {
      placeName: 'Satara',
      placeLatitude: -24.4,
      placeLongitude: 31.7,
      placePrecision: 'exact',
      placeNameSource: 'owner'
    }),
    { lookup: lc, place: { countryCode: 'ZA' } }
  )
  await addPhoto(
    ...placed('place-area', 'Hare', 'Lepus europaeus', 2, {
      placeName: 'Heath',
      placeLatitude: 52.123456,
      placeLongitude: 5.654321,
      placePrecision: 'area',
      placeNameSource: 'owner'
    }),
    { lookup: lc }
  )
  await addPhoto(
    ...placed('place-country', 'Beach', null, 3, {
      placeLatitude: 14.7,
      placeLongitude: 101.4,
      placePrecision: 'country'
    }),
    { place: { countryCode: 'TH', name: 'Pak Chong, Thailand' } }
  )
  await addPhoto(
    ...placed('place-hidden-precision', 'Lake', null, 4, {
      placeName: 'Home',
      placeLatitude: 10,
      placeLongitude: 10,
      placePrecision: 'hidden'
    })
  )
  await addPhoto(
    ...placed('place-threatened', 'Snow Leopard', 'Panthera uncia', 5, {
      placeName: 'Hemis',
      placeLatitude: 34.2,
      placeLongitude: 77.6,
      placePrecision: 'exact',
      placeNameSource: 'owner'
    }),
    { lookup: { status: 'resolved', iucn: 'CR' }, place: { countryCode: 'IN' } }
  )
  await addPhoto(
    ...placed('place-failed', 'Pangolin', 'Manis javanica', 6, {
      placeName: 'Burrow',
      placeLatitude: 3.1,
      placeLongitude: 101.6,
      placePrecision: 'exact',
      placeNameSource: 'owner'
    }),
    // The conservation check failed: the place fails closed.
    { lookup: { status: 'failed' } }
  )
  await addPhoto(
    ...placed('place-zone', 'Hill', null, 7, {
      placeName: 'Nest site',
      placeLatitude: 52,
      placeLongitude: 5,
      placePrecision: 'exact',
      placeNameSource: 'owner'
    })
  )
  await database.updateGallerySettings({
    actorId: ownerId,
    hiddenLocations: [{ latitude: 52, longitude: 5, hideRadiusMeters: 1000 }]
  })

  const make = async (
    title: string,
    names: string[],
    options: {
      visibility?: 'public' | 'private'
      description?: string
      cover?: string
    } = {}
  ) => {
    const created = await database.createGalleryAlbumWithinLimit({
      actorId: ownerId,
      title,
      description: options.description,
      visibility: options.visibility,
      limit: MAX_GALLERY_ALBUMS_PER_ACTOR,
      mediaIds: names.map((name) => media[name]),
      itemLimit: 2000
    })
    if (created.status !== 'created') throw new Error('album not created')
    if (options.cover) {
      const updated = await database.updateGalleryAlbum({
        id: created.album.id,
        actorId: ownerId,
        coverMediaId: media[options.cover]
      })
      if (updated.status !== 'updated') throw new Error('cover not set')
    }
    return created.album.id
  }

  const albums = {
    mixed: await make(
      'Mixed',
      ['public', 'unlisted', 'followers', 'direct', 'deleted', 'hidden'],
      { description: 'One photo for every kind of post.', cover: 'followers' }
    ),
    followersOnly: await make('Only followers', ['followers']),
    directOnly: await make('Only direct', ['direct']),
    goneOnly: await make('Gone', ['deleted', 'hidden']),
    secret: await make('Secret', ['public'], { visibility: 'private' }),
    empty: await make('Nothing yet', []),
    places: await make('Places', [
      'place-exact',
      'place-area',
      'place-country',
      'place-hidden-precision',
      'place-threatened',
      'place-failed',
      'place-zone'
    ])
  }

  // The relationships.
  await database.createFollow({
    actorId: ACTOR3_ID,
    targetActorId: ownerId,
    inbox: `${ACTOR3_ID}/inbox`,
    sharedInbox: 'https://llun.test/inbox',
    status: FollowStatus.enum.Accepted
  })
  const earlier = await database.createFollow({
    actorId: ACTOR4_ID,
    targetActorId: ownerId,
    inbox: `${ACTOR4_ID}/inbox`,
    sharedInbox: 'https://llun.test/inbox',
    status: FollowStatus.enum.Accepted
  })
  // What a block does to the follow, then the block itself.
  await database.updateFollowStatus({
    followId: earlier.id,
    status: FollowStatus.enum.Undo
  })
  await database.createBlock({
    actorId: ownerId,
    targetActorId: ACTOR4_ID,
    uri: `${ownerId}#blocks/matrix`
  })

  const actor = async (id: string) => {
    const found = await database.getActorFromId({ id })
    if (!found) throw new Error(`no actor ${id}`)
    return found
  }
  return {
    ownerId,
    media,
    albums,
    viewers: {
      follower: await actor(ACTOR3_ID),
      stranger: await actor(ACTOR2_ID),
      blocked: await actor(ACTOR4_ID)
    }
  }
}
