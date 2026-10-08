import { Database } from '@/lib/database/types'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { FollowStatus } from '@/lib/types/domain/follow'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

/**
 * Seeds ACTOR1's gallery for the account-scoped route tests: three photos on a
 * public post, one on a followers-only post, and ACTOR3 as an accepted
 * follower. Returns the media ids by name.
 */
export const seedGalleryRouteFixtures = async (
  database: Database
): Promise<Record<string, string>> => {
  const ids: Record<string, string> = {}
  const publicStatus = `${ACTOR1_ID}/statuses/gallery-route-public`
  const followersStatus = `${ACTOR1_ID}/statuses/gallery-route-followers`
  await database.createNote({
    id: publicStatus,
    url: publicStatus,
    actorId: ACTOR1_ID,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    text: 'public'
  })
  await database.createNote({
    id: followersStatus,
    url: followersStatus,
    actorId: ACTOR1_ID,
    to: [`${ACTOR1_ID}/followers`],
    cc: [],
    text: 'followers'
  })
  await database.createFollow({
    actorId: ACTOR3_ID,
    targetActorId: ACTOR1_ID,
    inbox: `${ACTOR3_ID}/inbox`,
    sharedInbox: 'https://llun.test/inbox',
    status: FollowStatus.enum.Accepted
  })

  const post = async (
    name: string,
    statusId: string,
    details: Parameters<Database['createMedia']>[0]['details']
  ) => {
    const media = await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: `/test/route-${name}.jpg`,
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 100, height: 100 }
      },
      details: { inGallery: true, ...details }
    })
    ids[name] = media!.id
    await database.createAttachment({
      actorId: ACTOR1_ID,
      statusId,
      mediaType: 'image/jpeg',
      url: `https://media.test/route-${name}.jpg`,
      width: 100,
      height: 100,
      mediaId: media!.id
    })
  }

  await post('kingfisher', publicStatus, {
    subjectName: 'Kingfisher',
    subjectScientificName: 'Alcedo atthis',
    subjectCategory: 'bird',
    takenAt: Date.UTC(2024, 2, 1),
    placeName: 'River',
    placeLatitude: 51.5543,
    placeLongitude: -0.0231,
    placePrecision: 'area'
  })
  await post('fox', publicStatus, {
    subjectName: 'Red Fox',
    subjectCategory: 'mammal',
    takenAt: Date.UTC(2023, 5, 1),
    placeLatitude: 40.7,
    placeLongitude: -74,
    placePrecision: 'exact'
  })
  await post('lakes', publicStatus, {
    subjectName: 'Lakes',
    subjectCategory: 'landscape',
    takenAt: Date.UTC(2022, 0, 1)
  })
  await post('heron', followersStatus, {
    subjectName: 'Grey Heron',
    subjectScientificName: 'Ardea cinerea',
    subjectCategory: 'bird',
    takenAt: Date.UTC(2024, 4, 1),
    placeLatitude: 20,
    placeLongitude: 20,
    placePrecision: 'exact'
  })
  return ids
}
