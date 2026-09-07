#!/usr/bin/env -S node scripts/run.cjs
/**
 * Backfills actor profiles for likes whose actorId is not yet in the `actors` table.
 *
 * Usage:
 *   NODE_ENV=production scripts/maintenance/backfillMissingLikeActors.ts \
 *     [--dry-run] [--batch-size 50] [--status-id <statusIdOrPublicId>]
 *
 * Options:
 *   --dry-run    Report missing actors without fetching or writing them
 *   --batch-size Number of actors to process per batch (default 50)
 *   --status-id  Only backfill actors who liked this specific status
 */
import { loadEnvConfig } from '@next/env'
import { Knex } from 'knex'

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getDatabase, getKnex } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { resolveStatusIdParam } from '@/lib/services/mastodon/resolveClientId'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const DEFAULT_BATCH_SIZE = 50

export interface BackfillOptions {
  dryRun?: boolean
  batchSize?: number
  statusId?: string
}

export interface BackfillResult {
  found: number
  recorded: number
  failed: number
}

const parseBooleanFlagValue = (value?: string) => {
  if (value === undefined || value === 'true') return true
  if (value === 'false') return false
  throw new Error(`Invalid boolean value: ${value}. Use true or false.`)
}

export const parseArgs = (args: string[]): BackfillOptions => {
  let dryRun = false
  let batchSize = DEFAULT_BATCH_SIZE
  let statusId: string | undefined

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`)
    }

    const [rawKey, inlineValue] = argument.slice(2).split('=', 2)

    if (rawKey === 'dry-run') {
      if (inlineValue !== undefined) {
        dryRun = parseBooleanFlagValue(inlineValue)
      } else if (args[index + 1] === 'true' || args[index + 1] === 'false') {
        dryRun = parseBooleanFlagValue(args[index + 1])
        index += 1
      } else {
        dryRun = true
      }
      continue
    }

    if (rawKey === 'batch-size') {
      const rawValue = inlineValue ?? args[index + 1]
      if (rawValue === undefined) {
        throw new Error('--batch-size requires a value')
      }
      if (inlineValue === undefined) {
        index += 1
      }
      const parsed = Number(rawValue)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(
          `--batch-size must be a positive integer, got ${rawValue}`
        )
      }
      batchSize = parsed
      continue
    }

    if (rawKey === 'status-id') {
      const rawValue = inlineValue ?? args[index + 1]
      if (!rawValue) {
        throw new Error('--status-id requires a value')
      }
      if (inlineValue === undefined) {
        index += 1
      }
      statusId = rawValue
      continue
    }

    throw new Error(`Unknown option: --${rawKey}`)
  }

  return { dryRun, batchSize, statusId }
}

export async function findMissingLikeActorIds(
  knexClient: Knex,
  options?: { statusId?: string; limit?: number }
): Promise<string[]> {
  let query = knexClient('likes')
    .distinct('likes.actorId')
    .leftJoin('actors', 'likes.actorId', 'actors.id')
    .whereNull('actors.id')

  if (options?.statusId) {
    query = query.where('likes.statusId', options.statusId)
  }

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  const rows = await query.select('likes.actorId')
  return rows.map((r) => r.actorId).filter(Boolean)
}

export async function backfillMissingLikeActors({
  database,
  knexClient,
  dryRun = false,
  batchSize = DEFAULT_BATCH_SIZE,
  statusId
}: {
  database: Database
  knexClient: Knex
  dryRun?: boolean
  batchSize?: number
  statusId?: string
}): Promise<BackfillResult> {
  const resolvedStatusId = statusId
    ? await resolveStatusIdParam(database, statusId)
    : undefined

  if (statusId) {
    console.log(`Filtering for status: ${resolvedStatusId}`)
  }

  const missingActorIds = await findMissingLikeActorIds(knexClient, {
    statusId: resolvedStatusId
  })

  console.log(`Found ${missingActorIds.length} missing actor(s) across likes.`)

  if (dryRun) {
    console.log('Dry-run mode: no actors will be fetched or saved.')
    for (const actorId of missingActorIds) {
      console.log(`  - ${actorId}`)
    }
    return { found: missingActorIds.length, recorded: 0, failed: 0 }
  }

  let recorded = 0
  let failed = 0

  for (let i = 0; i < missingActorIds.length; i += batchSize) {
    const chunk = missingActorIds.slice(i, i + batchSize)
    for (const actorId of chunk) {
      try {
        console.log(`Fetching actor: ${actorId}...`)
        const result = await recordActorIfNeeded({ actorId, database })
        if (result) {
          recorded += 1
          console.log(`  ✓ Recorded ${result.username ?? result.id}`)
        } else {
          failed += 1
          console.log(`  ✗ Unable to record ${actorId}`)
        }
      } catch (err) {
        failed += 1
        console.error(
          `  ✗ Error recording ${actorId}: ${(err as Error).message}`
        )
      }
    }
  }

  console.log(
    `Done. Found: ${missingActorIds.length}, Recorded: ${recorded}, Failed: ${failed}`
  )

  return { found: missingActorIds.length, recorded, failed }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const database = getDatabase()
  if (!database) {
    console.error('Database is not available')
    process.exit(1)
  }

  const knexClient = getKnex()

  try {
    const result = await backfillMissingLikeActors({
      database,
      knexClient,
      ...options
    })
    process.exit(result.failed > 0 ? 1 : 0)
  } finally {
    await database.destroy()
  }
}

if (process.argv[1]?.endsWith('backfillMissingLikeActors.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
