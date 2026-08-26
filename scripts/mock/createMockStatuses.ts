#!/usr/bin/env -S node scripts/run.cjs
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { Timeline } from '@/lib/services/timelines/types'
import { getMention } from '@/lib/types/domain/actor'
import { getLocalStatusId } from '@/lib/utils/activitypubId'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { generatePublicId } from '@/lib/utils/publicId'

async function createMockStatuses() {
  const database = getDatabase()
  if (!database) {
    console.error('Database not available')
    process.exit(1)
  }

  const config = getConfig()
  // Optional CLI username (consistent with createMockUser.ts); defaults to the
  // standard mock user.
  const username = process.argv[2] || 'testuser'
  const domain = config.host

  console.log(`Looking for user ${username} on ${domain}...`)
  const actor = await database.getActorFromUsername({ username, domain })
  if (!actor) {
    console.error('Test user not found. Run createMockUser.ts first.')
    process.exit(1)
  }

  console.log(`Creating mock statuses for ${actor.username}...`)

  const attachmentImages = [
    'https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?w=800&auto=format&fit=crop&q=60',
    'https://images.unsplash.com/photo-1682687221038-404670001d45?w=800&auto=format&fit=crop&q=60',
    'https://images.unsplash.com/photo-1682687220063-4742bd7fd538?w=800&auto=format&fit=crop&q=60',
    'https://images.unsplash.com/photo-1682687220199-d0124f48f95b?w=800&auto=format&fit=crop&q=60',
    'https://images.unsplash.com/photo-1682687220067-dced9a881b56?w=800&auto=format&fit=crop&q=60',
    'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?w=800&auto=format&fit=crop&q=60',
    'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?w=800&auto=format&fit=crop&q=60',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&auto=format&fit=crop&q=60'
  ]

  const externalActors = [
    {
      username: 'mira',
      domain: 'photos.example',
      name: 'Mira Park',
      summary: 'Chasing light and color. Remote photo diary.',
      iconUrl:
        'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=256&auto=format&fit=crop&q=60',
      headerImageUrl: attachmentImages[0]
    },
    {
      username: 'rico',
      domain: 'social.example',
      name: 'Rico Santos',
      summary: 'Street captures and coffee breaks.',
      iconUrl:
        'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=256&auto=format&fit=crop&q=60',
      headerImageUrl: attachmentImages[3]
    }
  ]

  const ensureExternalActor = async (
    externalActor: (typeof externalActors)[number]
  ) => {
    const existingActor = await database.getActorFromUsername({
      username: externalActor.username,
      domain: externalActor.domain
    })
    if (existingActor) return existingActor

    const actorId = `https://${externalActor.domain}/users/${externalActor.username}`
    const createdAt = Date.now()
    return database.createActor({
      actorId,
      username: externalActor.username,
      domain: externalActor.domain,
      name: externalActor.name,
      summary: externalActor.summary,
      iconUrl: externalActor.iconUrl,
      headerImageUrl: externalActor.headerImageUrl,
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: `https://${externalActor.domain}/inbox`,
      publicKey: `mock-public-key-${crypto.randomUUID()}`,
      createdAt
    })
  }

  // Seeds one multi-image status authored by `author`. Local (test user) and
  // remote (external actor) posts differ only in a few axes, captured as
  // options; both are always surfaced on the test user's home timelines.
  const createMockStatus = async ({
    author,
    local,
    imageCount,
    text,
    timeOffset = 0,
    imageOffset,
    imageSize,
    attachmentName
  }: {
    author: NonNullable<typeof actor>
    local: boolean
    imageCount: number
    text: string
    timeOffset?: number
    imageOffset: number
    imageSize: (index: number) => { width: number; height: number }
    attachmentName: (index: number) => string
  }) => {
    const createdAt = Date.now() + timeOffset // Future/recent so it sorts to the top
    // Local statuses follow `lib/actions/createNote.ts`: the id is the full
    // ActivityPub URI whose tail is the client-facing publicId, and the url is
    // the `@username` web form. Remote ones keep their origin's canonical URI
    // as both, the way federation delivers them, and let the database mint
    // their publicId.
    //
    // Storing a bare uuid as a local id (which this script used to do) makes
    // seeded posts behave unlike real ones: `urlToId` parses a bare uuid as a
    // hostname, so client calls such as `/api/v1/statuses/<id>/favourited_by`
    // resolve to no status and 404.
    const publicId = local ? generatePublicId(createdAt) : undefined
    const id = publicId
      ? getLocalStatusId({ actorId: author.id, statusId: publicId })
      : `https://${author.domain}/users/${author.username}/statuses/${crypto.randomUUID()}`
    const statusUrl = publicId
      ? `https://${author.domain}/${getMention(author)}/${publicId}`
      : id
    const imageLabel = `${imageCount} image${imageCount === 1 ? '' : 's'}`
    const body = local ? `${text} (${imageLabel})` : text

    const status = await database.createNote({
      id,
      publicId,
      actorId: author.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [author.followersUrl],
      url: statusUrl,
      text: `<p>${body}</p>`,
      createdAt
    })

    for (let index = 0; index < imageCount; index += 1) {
      const { width, height } = imageSize(index)
      await database.createAttachment({
        actorId: author.id,
        statusId: id,
        mediaType: 'image/jpeg',
        url: attachmentImages[(index + imageOffset) % attachmentImages.length],
        width,
        height,
        name: attachmentName(index)
      })
    }

    await database.createTimelineStatus({
      actorId: actor.id,
      status,
      timeline: Timeline.MAIN
    })

    console.log(
      local
        ? `Created status with ${imageLabel}: "${text}"`
        : `Created external status for ${author.username}: "${text}"`
    )
  }

  // The shapes the post media layout branches on: a lone attachment renders at
  // its own aspect ratio, and two or more become a fixed-height scrollable
  // strip whose items are each as wide as their own ratio makes them. Seeding
  // only one shape hides both behaviours, so these deliberately mix.
  const landscape = { width: 800, height: 600 }
  const portrait = { width: 600, height: 900 }
  const panorama = { width: 1200, height: 500 }
  const square = { width: 700, height: 700 }
  const mixedSizes = [landscape, portrait, panorama, square]
  const sameSize = (size: { width: number; height: number }) => () => size

  // Local statuses (recent timeOffsets so they appear at the top).
  const localStatuses = [
    {
      imageCount: 1,
      text: 'A single landscape photo.',
      timeOffset: 500,
      imageSize: sameSize(landscape)
    },
    {
      imageCount: 1,
      text: 'A single portrait photo.',
      timeOffset: 700,
      imageOffset: 1,
      imageSize: sameSize(portrait)
    },
    { imageCount: 2, text: 'Checking out 2 cool photos!', timeOffset: 1000 },
    { imageCount: 3, text: 'Here are 3 amazing shots.', timeOffset: 2000 },
    { imageCount: 4, text: 'A row of 4 images.', timeOffset: 3000 },
    { imageCount: 7, text: 'Photo dump! 7 images.', timeOffset: 4000 }
  ]
  for (const spec of localStatuses) {
    await createMockStatus({
      author: actor,
      local: true,
      imageOffset: 0,
      imageSize: (index) => mixedSizes[index % mixedSizes.length],
      attachmentName: (index) => `Image ${index + 1} for status`,
      ...spec
    })
  }

  const externalActorRecords = await Promise.all(
    externalActors.map(ensureExternalActor)
  )
  const externalStatuses = [
    {
      record: externalActorRecords[0],
      imageCount: 2,
      text: 'Coastal walk at golden hour.',
      timeOffset: 1500
    },
    {
      record: externalActorRecords[1],
      imageCount: 4,
      text: 'Late-night street reflections.',
      timeOffset: 2500
    }
  ]
  for (const { record, ...spec } of externalStatuses) {
    if (!record) continue
    await createMockStatus({
      author: record,
      local: false,
      imageOffset: 2,
      imageSize: sameSize({ width: 1000, height: 750 }),
      attachmentName: (index) => `External image ${index + 1}`,
      ...spec
    })
  }

  console.log('✅ Mock statuses with media created successfully!')
  process.exit(0)
}

createMockStatuses().catch((error) => {
  console.error('Error creating mock statuses:', error)
  process.exit(1)
})
