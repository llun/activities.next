#!/usr/bin/env -S node scripts/run.cjs
/**
 * Read-only preflight "doctor" for fitness-import recovery. Reports EXACTLY which
 * database the recovery scripts would connect to (so you can catch the common
 * `.env.local` shadowing `.env.production` trap), and whether the actor, Strava
 * settings, secret phase, storage, and the stored fitness files are actually
 * present. It mutates nothing.
 *
 * Run it with the SAME env you would run the recovery with. Because @next/env
 * loads `.env.local` at higher precedence than `.env.production` (even under
 * NODE_ENV=production), a stray `.env.local` will silently point this — and the
 * recovery — at your LOCAL database. This script surfaces that.
 *
 * Usage:
 *   NODE_ENV=production scripts/fitness/diagnoseFitnessImport.ts \
 *     --actor-id https://<host>/users/<username> \
 *     --activity-id <strava-activity-id> [--activity-id <id> ...] \
 *     [--batch-id <batch-id> ...] [--skip-token]
 */
import { loadEnvConfig } from '@next/env'

import { MINIMUM_PRODUCTION_SECRET_LENGTH, getConfig } from '@/lib/config'
import { getFitnessStorageConfig } from '@/lib/config/fitnessStorage'
import { getMediaStorageConfig } from '@/lib/config/mediaStorage'
import { getDatabase } from '@/lib/database'
import { groupFitnessActivitiesByOverlap } from '@/lib/jobs/fitnessImportOverlap'
import { getValidStravaAccessToken } from '@/lib/services/strava/activity'
import { getStravaActivityBatchId } from '@/lib/services/strava/activityBatch'
import { FitnessFile } from '@/lib/types/database/fitnessFile'

import { describeConnection } from './describeConnection'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const ok = (label: string, detail = '') =>
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
const bad = (label: string, detail = '') =>
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
const warn = (label: string, detail = '') =>
  console.log(`  ! ${label}${detail ? ` — ${detail}` : ''}`)

const parseArgs = (args: string[]) => {
  let actorId: string | undefined
  const activityIds: string[] = []
  const batchIds: string[] = []
  let skipToken = false

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--skip-token') {
      skipToken = true
      continue
    }
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`)
    const [key, inline] = arg.slice(2).split('=', 2)
    const value = inline ?? args[i + 1]
    if (!value || value.startsWith('--'))
      throw new Error(`Missing value for --${key}`)
    if (inline === undefined) i += 1
    if (key === 'actor-id') actorId = value
    else if (key === 'activity-id') activityIds.push(value)
    else if (key === 'batch-id') batchIds.push(value)
    else throw new Error(`Unknown argument: --${key}`)
  }
  if (!actorId) throw new Error('--actor-id is required')
  return { actorId, activityIds, batchIds, skipToken }
}

async function main() {
  let input: ReturnType<typeof parseArgs>
  try {
    input = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error((error as Error).message)
    return 1
  }

  // Hard blockers stop ALL recovery (wrong DB / missing actor). Strava
  // prerequisites (secret / settings / token) only gate the retrigerStrava path;
  // importStoredFitnessFile rebuilds from the stored file with no Strava, so a
  // Strava miss is a warning, not a blocker.
  let blockers = 0
  let stravaReady = true

  // 1. Which database ------------------------------------------------------
  console.log('\n[1] Database connection (what the recovery would use)')
  const { client, target, isLocal } = describeConnection()
  console.log(`  client: ${client}`)
  console.log(`  target: ${target}`)
  if (isLocal) {
    warn(
      'This looks LOCAL',
      'the recovery would run against this, NOT production. If you meant prod, move .env.local aside so .env.production wins.'
    )
  } else {
    ok('Remote database', 'this is a non-local host (expected for production)')
  }

  // 2. Secret phase & storage (needed to decrypt Strava creds + read/write media)
  console.log('\n[2] Runtime config')
  // Source the secret through the real config (getConfig validates the trimmed
  // length against MINIMUM_PRODUCTION_SECRET_LENGTH) rather than reading
  // process.env directly, so this reflects exactly what the app uses to decrypt
  // Strava tokens. getConfig() throws if the env config is incomplete.
  let secretLength: number | null = null
  let configError: string | null = null
  try {
    secretLength = getConfig().secretPhase.trim().length
  } catch (error) {
    configError = (error as Error).message
  }
  if (configError) {
    warn(
      'Runtime config could not be loaded',
      `${configError} — a too-short ACTIVITIES_SECRET_PHASE or another missing var; Strava decryption may fail (stored-file recovery still works)`
    )
    stravaReady = false
  } else if ((secretLength ?? 0) >= MINIMUM_PRODUCTION_SECRET_LENGTH) {
    ok('ACTIVITIES_SECRET_PHASE set', `${secretLength} chars`)
  } else {
    warn(
      'ACTIVITIES_SECRET_PHASE too short',
      `${secretLength} < ${MINIMUM_PRODUCTION_SECRET_LENGTH}; Strava token decrypts to empty (stored-file recovery still works)`
    )
    stravaReady = false
  }
  try {
    const fs = getFitnessStorageConfig()
    ok(
      'Fitness storage configured',
      String(fs?.fitnessStorage?.type ?? 'unknown')
    )
  } catch {
    warn(
      'Fitness storage config not resolved',
      'needed to read the stored .tcx'
    )
  }
  try {
    const ms = getMediaStorageConfig()
    ok('Media storage configured', String(ms?.mediaStorage?.type ?? 'unknown'))
  } catch {
    warn(
      'Media storage config not resolved',
      'needed to write the route map image'
    )
  }

  const database = getDatabase()
  if (!database) {
    bad('Database instance unavailable', 'check the database config above')
    console.log('\nVERDICT: BLOCKED — no database.')
    return 1
  }

  // 3. Actor ---------------------------------------------------------------
  console.log('\n[3] Actor')
  const actor = await database.getActorFromId({ id: input.actorId })
  if (actor) ok('Actor found', input.actorId)
  else {
    bad('Actor NOT found in this database', input.actorId)
    warn(
      'Most likely cause',
      'connected to the wrong (local) database — see [1]'
    )
    blockers += 1
  }

  // 4. Strava settings (the "config in database") --------------------------
  console.log(
    '\n[4] Strava settings row (fitness_settings, serviceType=strava)'
  )
  const settings = actor
    ? await database.getFitnessSettings({
        actorId: input.actorId,
        serviceType: 'strava'
      })
    : null
  if (!settings) {
    bad('No Strava settings row for this actor')
    warn(
      'Means',
      'either the actor never connected Strava in THIS db, or the row is not decryptable — retrigerStrava is out, use importStoredFitnessFile'
    )
    if (actor) stravaReady = false
  } else {
    ok('Strava settings row present')
    console.log(
      `      clientId:     ${settings.clientId ? 'present' : 'MISSING'}`
    )
    console.log(
      `      accessToken:  ${settings.accessToken ? 'present (decrypted)' : 'MISSING/undecryptable'}`
    )
    console.log(
      `      refreshToken: ${settings.refreshToken ? 'present (decrypted)' : 'MISSING/undecryptable'}`
    )
    if (!settings.accessToken && !settings.refreshToken) {
      warn(
        'No usable tokens',
        'row exists but tokens are empty — usually a wrong ACTIVITIES_SECRET_PHASE; use importStoredFitnessFile'
      )
      stravaReady = false
    }
  }

  // 5. Strava token validity (optional; makes a network call) --------------
  console.log('\n[5] Strava access token')
  if (input.skipToken) {
    warn('Skipped', '--skip-token given (no network refresh check)')
  } else if (settings) {
    try {
      const token = await getValidStravaAccessToken({
        database,
        fitnessSettings: settings
      })
      if (token)
        ok('Valid access token obtained', '(refresh works if it was expired)')
      else {
        warn(
          'Could not obtain a valid access token',
          'reconnect Strava for retrigerStrava, or use importStoredFitnessFile (no token needed)'
        )
        stravaReady = false
      }
    } catch (error) {
      warn('Token check errored', (error as Error).message)
      stravaReady = false
    }
  } else {
    warn('Skipped', 'no settings to check')
  }

  // 6. The stored files ----------------------------------------------------
  console.log('\n[6] Stored fitness files')
  const batchIds = [
    ...input.batchIds,
    ...input.activityIds.map((id) => getStravaActivityBatchId(id))
  ]
  if (batchIds.length === 0) {
    warn(
      'No --activity-id / --batch-id given',
      'pass them to inspect the orphaned files'
    )
  }
  const found: FitnessFile[] = []
  for (const batchId of batchIds) {
    const files = (await database.getFitnessFilesByBatchId({ batchId })).filter(
      (f) => f.actorId === input.actorId
    )
    if (files.length === 0) {
      bad(`batch ${batchId}`, 'no file for this actor in this database')
      continue
    }
    for (const f of files) {
      found.push(f)
      const orphan = !f.statusId
      const start =
        typeof f.activityStartTime === 'number'
          ? new Date(f.activityStartTime).toISOString()
          : '(none)'
      const distance =
        typeof f.totalDistanceMeters === 'number'
          ? `${(f.totalDistanceMeters / 1000).toFixed(2)} km`
          : '?'
      console.log(
        `  ${orphan ? '!' : '✓'} ${batchId}\n` +
          `      id=${f.id} file=${f.fileName}\n` +
          `      start=${start} duration=${f.totalDurationSeconds ?? '?'}s distance=${distance}\n` +
          `      importStatus=${f.importStatus ?? '(null)'} processingStatus=${f.processingStatus ?? '(null)'}\n` +
          `      statusId=${f.statusId ?? '(none — ORPHANED, no post created)'}`
      )
    }
  }

  // 7. Same-ride overlap (would these merge into ONE post?) ----------------
  if (found.length >= 2) {
    console.log(
      '\n[7] Same-ride overlap (>=80% start+duration overlap => one post)'
    )
    const withTimes = found.filter(
      (f) =>
        typeof f.activityStartTime === 'number' &&
        typeof f.totalDurationSeconds === 'number' &&
        f.totalDurationSeconds > 0
    )
    if (withTimes.length < 2) {
      warn(
        'Not enough parsed start-time + duration to compare',
        'the merge check needs both files parsed'
      )
    } else {
      const groups = groupFitnessActivitiesByOverlap(
        withTimes.map((f) => ({
          id: f.id,
          startTimeMs: f.activityStartTime as number,
          durationSeconds: f.totalDurationSeconds as number
        })),
        0.8
      )
      const mergedGroups = groups.filter((g) => g.length >= 2)
      if (mergedGroups.length === 0) {
        ok('Distinct rides', 'no >=80% overlap — separate posts are correct')
      } else {
        for (const group of mergedGroups) {
          const groupFiles = group
            .map((e) => found.find((f) => f.id === e.id))
            .filter((f): f is FitnessFile => Boolean(f))
          const statusIds = new Set(
            groupFiles.map((f) => f.statusId ?? '(none)')
          )
          ok(
            'These WOULD merge into ONE post',
            groupFiles.map((f) => f.fileName).join(' + ')
          )
          console.log(
            `      currently on ${statusIds.size} separate status(es): ${[...statusIds].join(', ')}`
          )
          if (statusIds.size > 1) {
            warn(
              'They are DUPLICATE posts now',
              'delete one from the UI, or re-import both together to consolidate'
            )
          }
        }
      }
    }
  }

  // Verdict ----------------------------------------------------------------
  console.log('\n=== VERDICT ===')
  const orphanCount = found.filter((f) => !f.statusId).length
  if (blockers > 0) {
    console.log(
      `BLOCKED — ${blockers} hard prerequisite(s) failed (see [1]/[3]). Fix the database/actor targeting first.`
    )
  } else if (batchIds.length > 0 && found.length === 0) {
    console.log(
      'NO FILES — none of the given activity/batch ids resolve to a stored file for this actor in this database (wrong DB or wrong ids).'
    )
  } else if (found.length > 0 && orphanCount === 0) {
    console.log('NOTHING TO DO — every file found already has a post.')
  } else {
    console.log(
      'RECOVERABLE against this database. To recreate the missing post(s):'
    )
    console.log(
      stravaReady
        ? '  • retrigerStravaActivities  — re-fetches the Strava activity (restores caption/photos); use if it still exists on Strava.'
        : '  • retrigerStravaActivities  — NOT available (Strava creds/token missing above).'
    )
    console.log(
      '  • importStoredFitnessFile   — rebuilds from the already-stored file, no Strava; use if the activity was deleted from Strava or Strava is unavailable.'
    )
  }
  return blockers > 0 ? 1 : 0
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}
