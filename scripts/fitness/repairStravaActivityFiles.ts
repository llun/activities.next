#!/usr/bin/env -S node scripts/run.cjs
/**
 * Repair script to backfill old Strava activity files with full stream data.
 *
 * When Strava activities were first imported, only time/latlng/altitude/distance
 * streams were fetched. This script re-fetches all available streams from Strava
 * and overwrites the stored GPX/TCX files with enriched data (heartrate, power,
 * speed, cadence, temperature).
 *
 * Activities that have been deleted from Strava (404) are, by default, only
 * reported. Pass --delete-missing to hard-delete their S3 file, database record,
 * and associated status post. That deletion is IRREVERSIBLE.
 *
 * Usage:
 *   NODE_ENV=production scripts/fitness/repairStravaActivityFiles.ts \
 *     [--actor-id https://<host>/users/<username>] \
 *     [--delete-missing] \
 *     [--dry-run]
 *
 * Options:
 *   --actor-id        Limit repairs to a specific actor (optional, repairs all actors)
 *   --delete-missing  Hard-delete activities returning 404 from Strava (S3 file, DB
 *                     record, and status). Default off = report only. IRREVERSIBLE.
 *   --dry-run         Print what would be done without modifying anything
 *
 * Only S3/Object storage backends are supported.
 */
import {
  DeleteObjectCommand,
  PutObjectCommand,
  type S3Client
} from '@aws-sdk/client-s3'
import { loadEnvConfig } from '@next/env'
import knex from 'knex'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { FitnessStorageType } from '@/lib/config/fitnessStorage'
import { getDatabase } from '@/lib/database'
import { getEffectiveFitnessStorageConfig } from '@/lib/services/fitness-files'
import { createStorageS3Client } from '@/lib/services/storage/s3Client'
import {
  buildGpxFromStravaStreams,
  buildTcxFromStravaStreams,
  getStravaActivity,
  getStravaActivityStreams,
  getValidStravaAccessToken
} from '@/lib/services/strava/activity'
import { getStravaActivityIdFromBatchId } from '@/lib/services/strava/activityBatch'

import { printDatabaseBanner } from './describeConnection'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const CliArgs = z.object({
  actorId: z.string().optional(),
  deleteMissing: z.boolean(),
  dryRun: z.boolean()
})

const USAGE = `Usage: NODE_ENV=production scripts/fitness/repairStravaActivityFiles.ts \\
  [--actor-id https://<host>/users/<username>] \\
  [--delete-missing] \\
  [--dry-run]

  --delete-missing hard-deletes activities that Strava returns 404 for (S3 file,
  DB record, and status). Default off = report only. This deletion is IRREVERSIBLE.`

const parseArgs = (args: string[]) => {
  let actorId: string | undefined
  let deleteMissing = false
  let dryRun = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`)
    }

    const [rawKey, inlineValue] = argument.slice(2).split('=', 2)

    if (rawKey === 'dry-run') {
      dryRun = true
    } else if (rawKey === 'delete-missing') {
      deleteMissing = true
    } else if (rawKey === 'actor-id') {
      const nextValue = inlineValue ?? args[index + 1]
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error(`Missing value for --${rawKey}`)
      }
      if (inlineValue === undefined) {
        index += 1
      }
      actorId = nextValue
    } else {
      throw new Error(`Unknown argument: --${rawKey}`)
    }
  }

  return CliArgs.parse({ actorId, deleteMissing, dryRun })
}

type StravaFitnessFileRow = {
  id: string
  actorId: string
  statusId: string | null
  path: string
  fileType: string
  importBatchId: string
}

async function repairStravaActivityFiles(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return 0
  }

  let input: z.infer<typeof CliArgs>
  try {
    input = parseArgs(args)
  } catch (error) {
    const nodeError = error as Error
    console.error(nodeError.message)
    console.error(USAGE)
    return 1
  }

  printDatabaseBanner()

  const config = getConfig()
  const database = getDatabase()
  if (!database) {
    console.error('Error: Database is not available')
    return 1
  }

  const fitnessStorage = getEffectiveFitnessStorageConfig()
  if (
    !fitnessStorage ||
    (fitnessStorage.type !== FitnessStorageType.S3Storage &&
      fitnessStorage.type !== FitnessStorageType.ObjectStorage)
  ) {
    console.error('Error: Only S3/Object storage backends are supported')
    return 1
  }

  const s3Client = createStorageS3Client(fitnessStorage)
  const { bucket, prefix } = fitnessStorage

  // Use a raw knex instance to query/update with a LIKE filter (not in the database abstraction)
  const rawDb = knex(config.database)
  let files: StravaFitnessFileRow[]
  try {
    let query = rawDb<StravaFitnessFileRow>('fitness_files')
      .where('importBatchId', 'like', 'strava-activity:%')
      .whereNull('deletedAt')
      .whereIn('fileType', ['gpx', 'tcx'])
      .orderBy('actorId', 'asc')
      .orderBy('createdAt', 'asc')
      .select([
        'id',
        'actorId',
        'statusId',
        'path',
        'fileType',
        'importBatchId'
      ])

    if (input.actorId) {
      query = query.where('actorId', input.actorId)
    }

    files = await query
  } catch (error) {
    await rawDb.destroy()
    throw error
  }

  const actorLabel = input.actorId ? ` for actor ${input.actorId}` : ''
  console.log(
    `Found ${files.length} Strava activity file(s) to repair${actorLabel}`
  )
  if (input.dryRun) {
    console.log('Dry-run mode: no changes will be made')
  }
  console.log()

  // Cache valid access tokens per actor to avoid redundant DB lookups and token refreshes
  const accessTokenCache = new Map<string, string | null>()

  let updatedCount = 0
  let deletedCount = 0
  let missingCount = 0
  let skipCount = 0
  let failureCount = 0

  for (const file of files) {
    const stravaActivityId = getStravaActivityIdFromBatchId(file.importBatchId)
    if (!stravaActivityId) {
      console.log(
        `  [${file.fileType.toUpperCase()}] ${file.path} (import batch ${file.importBatchId})`
      )
      console.log(`    ✗ Could not parse Strava activity id from import batch`)
      failureCount += 1
      continue
    }
    console.log(
      `  [${file.fileType.toUpperCase()}] ${file.path} (Strava #${stravaActivityId})`
    )

    try {
      // Get (and cache) the access token for this actor
      let accessToken = accessTokenCache.get(file.actorId)
      if (accessToken === undefined) {
        const fitnessSettings = await database.getFitnessSettings({
          actorId: file.actorId,
          serviceType: 'strava'
        })
        if (!fitnessSettings) {
          console.log(
            `    ✗ No Strava settings found for actor ${file.actorId}`
          )
          accessTokenCache.set(file.actorId, null)
          failureCount += 1
          continue
        }
        const token = await getValidStravaAccessToken({
          database,
          fitnessSettings
        })
        accessToken = token ?? null
        accessTokenCache.set(file.actorId, accessToken)
      }

      if (!accessToken) {
        console.log(`    ✗ Could not get a valid Strava access token`)
        failureCount += 1
        continue
      }

      const [activity, streams] = await Promise.all([
        getStravaActivity({ activityId: stravaActivityId, accessToken }),
        getStravaActivityStreams({ activityId: stravaActivityId, accessToken })
      ])

      let newContent: string | null = null
      let contentType: string
      let newFileType: string

      // Always prefer TCX: it supports all GPX data plus power (watts).
      // If the stored file is GPX but TCX content is available (e.g. watts
      // data now fetchable), upgrade to TCX in-place by overwriting the S3
      // object and updating the DB metadata.
      const tcxContent = buildTcxFromStravaStreams(activity, streams)
      if (tcxContent) {
        newContent = tcxContent
        contentType = 'application/vnd.garmin.tcx+xml'
        newFileType = 'tcx'
      } else if (file.fileType === 'gpx') {
        if (!streams) {
          console.log(`    ⚠ No streams available for GPX activity, skipping`)
          skipCount += 1
          continue
        }
        newContent = buildGpxFromStravaStreams(activity, streams)
        contentType = 'application/gpx+xml'
        newFileType = 'gpx'
      } else {
        console.log(`    ⚠ Generated file content is empty, skipping`)
        skipCount += 1
        continue
      }

      if (!newContent) {
        console.log(`    ⚠ Generated file content is empty, skipping`)
        skipCount += 1
        continue
      }

      const body = Buffer.from(newContent, 'utf-8')

      if (input.dryRun) {
        const upgradeNote =
          newFileType !== file.fileType
            ? ` (upgrading ${file.fileType.toUpperCase()} → ${newFileType.toUpperCase()})`
            : ''
        console.log(
          `    ✓ Would overwrite (${body.length} bytes)${upgradeNote}`
        )
        updatedCount += 1
        continue
      }

      const s3Key = prefix ? `${prefix}${file.path}` : file.path
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length
        })
      )

      if (newFileType !== file.fileType) {
        await rawDb('fitness_files').where('id', file.id).update({
          fileType: newFileType,
          mimeType: contentType,
          updatedAt: new Date()
        })
        console.log(
          `    ✓ Upgraded ${file.fileType.toUpperCase()} → ${newFileType.toUpperCase()} (${body.length} bytes)`
        )
      } else {
        console.log(`    ✓ Overwritten (${body.length} bytes)`)
      }
      updatedCount += 1
    } catch (error) {
      const nodeError = error as Error
      if (!nodeError.message.includes('(404)')) {
        console.error(`    ✗ Failed: ${nodeError.message}`)
        failureCount += 1
        continue
      }

      // Activity was deleted from Strava — clean up the S3 file, DB record, and status
      const s3Key = prefix ? `${prefix}${file.path}` : file.path
      const statusLabel = file.statusId ? ` + status ${file.statusId}` : ''

      // Deleting is irreversible, so only do it when explicitly opted in.
      if (!input.deleteMissing) {
        console.log(
          `    ⚠ Activity removed from Strava — S3 file, fitness file record${statusLabel} would be deleted (re-run with --delete-missing to remove)`
        )
        missingCount += 1
        continue
      }

      if (input.dryRun) {
        console.log(
          `    ✓ Would delete S3 file, fitness file record${statusLabel} (activity removed from Strava)`
        )
        deletedCount += 1
        continue
      }

      try {
        await s3Client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: s3Key })
        )
        await database.deleteFitnessFile({ id: file.id })
        if (file.statusId) {
          await database.deleteStatus({ statusId: file.statusId })
        }
        console.log(
          `    ✓ Deleted S3 file, fitness file record${statusLabel} (activity removed from Strava)`
        )
        deletedCount += 1
      } catch (deleteError) {
        const deleteNodeError = deleteError as Error
        console.error(`    ✗ Cleanup failed: ${deleteNodeError.message}`)
        failureCount += 1
      }
    }
  }

  await rawDb.destroy()

  const dryRunLabel = input.dryRun ? ' (dry-run)' : ''
  console.log(
    `\nDone${dryRunLabel}: ${updatedCount} updated, ${deletedCount} deleted, ${missingCount} missing (report only), ${skipCount} skipped, ${failureCount} failed out of ${files.length} total`
  )
  return failureCount > 0 ? 1 : 0
}

if (require.main === module) {
  repairStravaActivityFiles()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}
