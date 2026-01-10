import { getConfig } from '../lib/config'
import { getDatabase } from '../lib/database'
import { Timeline } from '../lib/services/timelines/types'
import { ACTIVITY_STREAM_PUBLIC } from '../lib/utils/activitystream'

async function createMockStatuses() {
  const database = getDatabase()
  if (!database) {
    console.error('Database not available')
    process.exit(1)
  }

  const config = getConfig()
  const username = 'testuser'
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

  const createStatusWithImages = async (
    imageCount: number,
    text: string,
    timeOffset = 0
  ) => {
    const id = crypto.randomUUID()
    const url = `https://${domain}/users/${username}/statuses/${id}`
    const createdAt = Date.now() + timeOffset // Future/Recent to show up top

    const status = await database.createNote({
      id,
      actorId: actor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [actor.followersUrl],
      url,
      text: `<p>${text} (${imageCount} images)</p>`,
      createdAt
    })

    for (let i = 0; i < imageCount; i++) {
      const imageUrl = attachmentImages[i % attachmentImages.length]
      await database.createAttachment({
        actorId: actor.id,
        statusId: id,
        mediaType: 'image/jpeg',
        url: imageUrl,
        width: 800,
        height: 600,
        name: `Image ${i + 1} for status`
      })
    }

    await database.createTimelineStatus({
      actorId: actor.id,
      status,
      timeline: Timeline.MAIN
    })

    await database.createTimelineStatus({
      actorId: actor.id,
      status,
      timeline: Timeline.NOANNOUNCE
    })
    console.log(`Created status with ${imageCount} images: "${text}"`)
  }

  const createExternalStatusWithImages = async (
    externalActor: Awaited<ReturnType<typeof ensureExternalActor>>,
    imageCount: number,
    text: string,
    timeOffset = 0
  ) => {
    if (!externalActor) return
    const id = crypto.randomUUID()
    const statusId = `https://${externalActor.domain}/users/${externalActor.username}/statuses/${id}`
    const createdAt = Date.now() + timeOffset

    const status = await database.createNote({
      id: statusId,
      actorId: externalActor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [externalActor.followersUrl],
      url: statusId,
      text: `<p>${text}</p>`,
      createdAt
    })

    for (let i = 0; i < imageCount; i++) {
      const imageUrl = attachmentImages[(i + 2) % attachmentImages.length]
      await database.createAttachment({
        actorId: externalActor.id,
        statusId,
        mediaType: 'image/jpeg',
        url: imageUrl,
        width: 1000,
        height: 750,
        name: `External image ${i + 1}`
      })
    }

    await database.createTimelineStatus({
      actorId: actor.id,
      status,
      timeline: Timeline.MAIN
    })

    await database.createTimelineStatus({
      actorId: actor.id,
      status,
      timeline: Timeline.NOANNOUNCE
    })

    console.log(
      `Created external status for ${externalActor.username}: "${text}"`
    )
  }

  // Create specific multi-image statuses (added recently so they appear at the top)
  await createStatusWithImages(2, 'Checking out 2 cool photos!', 1000)
  await createStatusWithImages(3, 'Here are 3 amazing shots.', 2000)
  await createStatusWithImages(4, 'A grid of 4 images.', 3000)
  await createStatusWithImages(7, 'Photo dump! 7 images.', 4000)

  const externalActorRecords = await Promise.all(
    externalActors.map(ensureExternalActor)
  )

  await createExternalStatusWithImages(
    externalActorRecords[0],
    2,
    'Coastal walk at golden hour.',
    1500
  )
  await createExternalStatusWithImages(
    externalActorRecords[1],
    4,
    'Late-night street reflections.',
    2500
  )

  console.log('✅ Multi-image mock statuses created successfully!')
  process.exit(0)
}

createMockStatuses().catch((error) => {
  console.error('Error creating mock statuses:', error)
  process.exit(1)
})
