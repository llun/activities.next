#!/usr/bin/env -S node -r @swc-node/register
/**
 * Script to list Strava webhooks for a given actor
 * Usage: NODE_ENV=production scripts/listStravaWebhooks [@username@domain]
 */
import { loadEnvConfig } from '@next/env'

import { getDatabase } from '@/lib/database'
import { getSubscription } from '@/lib/services/strava/webhookSubscription'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

export async function listStravaWebhooks(args = process.argv.slice(2)) {
  const input = args[0]
  if (!input) {
    console.error(
      'Usage: NODE_ENV=production scripts/listStravaWebhooks @username@domain'
    )
    return 1
  }

  // Parse @username@domain format
  const match = input.match(/^@?([^@]+)@([^@]+)$/)
  if (!match) {
    console.error(
      'Error: Invalid format. Use @username@domain (e.g. @ride@llun.social)'
    )
    return 1
  }
  const [, username, domain] = match

  console.log(`Looking up Strava webhook for user: ${username}@${domain}`)

  const database = getDatabase()

  if (!database) {
    console.error('Error: Database is not available')
    return 1
  }

  const actor = await database.getActorFromUsername({ username, domain })
  if (!actor) {
    console.error(`Error: Actor not found for username ${username}@${domain}`)
    return 1
  }

  const fitnessSettings = await database.getFitnessSettings({
    actorId: actor.id,
    serviceType: 'strava'
  })

  if (
    !fitnessSettings ||
    !fitnessSettings.clientId ||
    !fitnessSettings.clientSecret
  ) {
    console.error(`Error: Strava not configured for user ${username}@${domain}`)
    return 1
  }

  try {
    const subscription = await getSubscription(
      fitnessSettings.clientId,
      fitnessSettings.clientSecret
    )
    if (subscription) {
      console.log('Webhook Subscription Found:')
      console.log(JSON.stringify(subscription, null, 2))
    } else {
      console.log('No active Webhook Subscription found.')
    }
  } catch (error) {
    console.error('Error fetching Strava subscription:', error)
    return 1
  }

  return 0
}

if (require.main === module) {
  listStravaWebhooks()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Unexpected error:', error)
      process.exit(1)
    })
}
