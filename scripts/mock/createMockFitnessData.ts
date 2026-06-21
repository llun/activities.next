#!/usr/bin/env -S node scripts/run.cjs
/**
 * Seeds completed, primary fitness files (with activity metadata) and a few
 * linked fitness posts for the local mock user, so the `/fitness` Overview,
 * calendar, and Recent activities feed render with realistic data.
 *
 * Usage (local SQLite only — never a remote DB):
 *   set -a; . ./.env.local; set +a
 *   node scripts/run.cjs scripts/mock/createMockFitnessData.ts [username]
 *
 * Run after createMockUser.ts.
 */
import crypto from 'crypto'

import { getConfig } from '@/lib/config'
import { getDatabase, getKnex } from '@/lib/database'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const DAY_MS = 24 * 60 * 60 * 1000

interface ActivityTemplate {
  activityType: string
  fileType: string
  distanceMeters: number
  durationSeconds: number
  elevationGainMeters: number
  device: string
  text: string
}

const TEMPLATES: ActivityTemplate[] = [
  {
    activityType: 'run',
    fileType: 'fit',
    distanceMeters: 8210,
    durationSeconds: 2538,
    elevationGainMeters: 87,
    device: 'Garmin Forerunner 265',
    text: 'Morning run done — 8.2 km along the river. Cold but bright; the new shoes are holding up surprisingly well.'
  },
  {
    activityType: 'ride',
    fileType: 'gpx',
    distanceMeters: 24600,
    durationSeconds: 3720,
    elevationGainMeters: 142,
    device: 'Wahoo ELEMNT Bolt',
    text: 'Cycling the new route through the park. Loop time crept up from the heatwave — drinking more water next time.'
  },
  {
    activityType: 'run',
    fileType: 'gpx',
    distanceMeters: 5050,
    durationSeconds: 1560,
    elevationGainMeters: 34,
    device: 'Apple Watch Ultra',
    text: 'Easy recovery 5k. Legs felt heavy but the lake loop is always worth it.'
  },
  {
    activityType: 'ride',
    fileType: 'fit',
    distanceMeters: 41200,
    durationSeconds: 6300,
    elevationGainMeters: 380,
    device: 'Garmin Edge 840',
    text: 'Long Sunday ride into the hills. Brutal climb at km 28, glorious descent after.'
  },
  {
    activityType: 'walk',
    fileType: 'gpx',
    distanceMeters: 3600,
    durationSeconds: 2700,
    elevationGainMeters: 12,
    device: 'Pixel Watch',
    text: 'Evening wind-down walk. Nothing fast, just clearing the head.'
  }
]

const jitter = (base: number, spreadFraction: number) => {
  const spread = base * spreadFraction
  return Math.round(base - spread + Math.random() * spread * 2)
}

async function createMockFitnessData() {
  const database = getDatabase()
  if (!database) {
    console.error('Database not available')
    process.exit(1)
  }
  const knex = getKnex()

  const config = getConfig()
  const username = process.argv[2] || 'testuser'
  const domain = config.host

  console.log(`Looking for user ${username} on ${domain}...`)
  const actor = await database.getActorFromUsername({ username, domain })
  if (!actor) {
    console.error('Test user not found. Run createMockUser.ts first.')
    process.exit(1)
  }

  // Spread ~40 activities across the last ~22 weeks (roughly 6 months) so the
  // calendar heatmap and the 90-day default range both look populated.
  const totalActivities = 40
  const now = Date.now()

  console.log(
    `Seeding ${totalActivities} fitness activities for ${username}...`
  )

  let created = 0
  for (let index = 0; index < totalActivities; index += 1) {
    const template = TEMPLATES[index % TEMPLATES.length]
    // Most recent activities first: index 0 ≈ ~12 minutes ago, then stepping
    // back a few days at a time with a little jitter.
    const daysAgo = index === 0 ? 0 : index * 4 + Math.floor(Math.random() * 3)
    const startedAtMs =
      index === 0 ? now - 12 * 60 * 1000 : now - daysAgo * DAY_MS
    const startedAt = new Date(startedAtMs)

    const distanceMeters = jitter(template.distanceMeters, 0.18)
    const durationSeconds = jitter(template.durationSeconds, 0.18)
    const elevationGainMeters = jitter(template.elevationGainMeters, 0.25)

    // Link the three most-recent activities to real posts so the
    // "Recent activities" feed has content.
    let statusId: string | null = null
    if (index < 3) {
      const id = crypto.randomUUID()
      const url = `https://${domain}/users/${username}/statuses/${id}`
      await database.createNote({
        id,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [actor.followersUrl],
        url,
        text: `<p>${template.text}</p>`,
        createdAt: startedAtMs
      })
      statusId = id
    }

    const fileDate = startedAt.toISOString().slice(0, 10)
    const fileName = `${fileDate}-${template.activityType}.${template.fileType}`
    const bytes = jitter(180000, 0.4)

    await knex('fitness_files').insert({
      id: crypto.randomUUID(),
      actorId: actor.id,
      statusId,
      path: `mock/${actor.id}/${fileName}`,
      fileName,
      fileType: template.fileType,
      mimeType: 'application/octet-stream',
      bytes,
      description: `${template.device}`,
      hasMapData: template.fileType === 'gpx',
      mapImagePath: null,
      isPrimary: true,
      importBatchId: null,
      importStatus: null,
      importError: null,
      processingStatus: 'completed',
      totalDistanceMeters: distanceMeters,
      totalDurationSeconds: durationSeconds,
      elevationGainMeters,
      activityType: template.activityType,
      activityStartTime: startedAt,
      createdAt: startedAt,
      updatedAt: startedAt
    })
    created += 1
  }

  console.log(`✅ Seeded ${created} fitness activities (3 linked to posts).`)
  process.exit(0)
}

createMockFitnessData().catch((error) => {
  console.error('Error creating mock fitness data:', error)
  process.exit(1)
})
