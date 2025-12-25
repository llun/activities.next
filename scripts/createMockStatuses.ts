import { getDatabase } from '../lib/database'
import { getConfig } from '../lib/config'
import { ACTIVITY_STREAM_PUBLIC } from '../lib/utils/jsonld/activitystream'
import { Timeline } from '../lib/services/timelines/types'

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
    console.error('Test user not found. Run createTestUser.ts first.')
    process.exit(1)
  }

  console.log(`Creating mock statuses for ${actor.username}...`)

  const images = [
     'https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?w=800&auto=format&fit=crop&q=60',
     'https://images.unsplash.com/photo-1682687221038-404670001d45?w=800&auto=format&fit=crop&q=60',
     'https://images.unsplash.com/photo-1682687220063-4742bd7fd538?w=800&auto=format&fit=crop&q=60',
     'https://images.unsplash.com/photo-1682687220199-d0124f48f95b?w=800&auto=format&fit=crop&q=60',
     'https://images.unsplash.com/photo-1682687220067-dced9a881b56?w=800&auto=format&fit=crop&q=60',
     'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?w=800&auto=format&fit=crop&q=60',
     'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?w=800&auto=format&fit=crop&q=60',
     'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&auto=format&fit=crop&q=60'
  ]

  const createStatusWithImages = async (imageCount: number, text: string, timeOffset = 0) => {
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
       const imageUrl = images[i % images.length]
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

  // Create specific multi-image statuses (added recently so they appear at the top)
  await createStatusWithImages(2, "Checking out 2 cool photos!", 1000)
  await createStatusWithImages(3, "Here are 3 amazing shots.", 2000)
  await createStatusWithImages(4, "A grid of 4 images.", 3000)
  await createStatusWithImages(7, "Photo dump! 7 images.", 4000)
  
  console.log('✅ Multi-image mock statuses created successfully!')
  process.exit(0)
}

createMockStatuses().catch((error) => {
  console.error('Error creating mock statuses:', error)
  process.exit(1)
})
