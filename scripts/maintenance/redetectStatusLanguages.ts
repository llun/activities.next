#!/usr/bin/env -S node scripts/run.cjs
/**
 * Scans statuses (Notes and Polls) and re-evaluates language detection using
 * the updated detection engine (ELD + tinyld with NFKC normalization).
 *
 * Updates or clears entries in `status_detected_languages` when re-detection
 * differs from the currently stored record.
 *
 * Features:
 * - Keyset-based pagination by `statuses.id` (deterministic and resumable)
 * - Safe concurrent edit handling via `status.updatedAt` verification
 * - Bounded memory execution with configurable batch size
 * - Dry-run mode for auditing without writes
 * - Idempotent: repeated runs make no changes once converged
 *
 * Usage:
 *   NODE_ENV=production scripts/maintenance/redetectStatusLanguages.ts \
 *     [--dry-run] [--batch-size 200] [--resume-from <statusId>] [--limit <n>]
 *
 * Options:
 *   --dry-run      Audit differences without writing to status_detected_languages
 *   --batch-size   Number of statuses to fetch and process per batch (default 200)
 *   --resume-from  Status ID to resume from (processes statuses with id > resumeFrom)
 *   --limit        Maximum total statuses to process across all batches
 */
import { loadEnvConfig } from '@next/env'
import { Knex } from 'knex'

import { getDatabase, getKnex } from '@/lib/database'
import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { Database } from '@/lib/database/types'
import { detectLanguageFromHtml } from '@/lib/services/language-detection'

import { printDatabaseBanner } from '../fitness/describeConnection'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

export const DEFAULT_BATCH_SIZE = 200

export interface RedetectOptions {
  dryRun?: boolean
  batchSize?: number
  resumeFrom?: string
  limit?: number
}

export interface RedetectResult {
  scanned: number
  newlyDetected: number
  updated: number
  cleared: number
  unchanged: number
  skippedConcurrent: number
  failed: number
  lastProcessedId: string | null
}

const parseBooleanFlagValue = (value?: string) => {
  if (value === undefined || value === 'true') return true
  if (value === 'false') return false
  throw new Error(`Invalid boolean value: ${value}. Use true or false.`)
}

export const parseArgs = (args: string[]): RedetectOptions => {
  let dryRun = false
  let batchSize = DEFAULT_BATCH_SIZE
  let resumeFrom: string | undefined
  let limit: number | undefined

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

    if (rawKey === 'resume-from') {
      const rawValue = inlineValue ?? args[index + 1]
      if (!rawValue) {
        throw new Error('--resume-from requires a value')
      }
      if (inlineValue === undefined) {
        index += 1
      }
      resumeFrom = rawValue
      continue
    }

    if (rawKey === 'limit') {
      const rawValue = inlineValue ?? args[index + 1]
      if (!rawValue) {
        throw new Error('--limit requires a value')
      }
      if (inlineValue === undefined) {
        index += 1
      }
      const parsed = Number(rawValue)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--limit must be a positive integer, got ${rawValue}`)
      }
      limit = parsed
      continue
    }

    throw new Error(`Unknown option: --${rawKey}`)
  }

  return { dryRun, batchSize, resumeFrom, limit }
}

export async function redetectStatusLanguages({
  database,
  knexClient,
  dryRun = false,
  batchSize = DEFAULT_BATCH_SIZE,
  resumeFrom,
  limit
}: {
  database: Database
  knexClient: Knex
  dryRun?: boolean
  batchSize?: number
  resumeFrom?: string
  limit?: number
}): Promise<RedetectResult> {
  let cursor = resumeFrom
  let scanned = 0
  let newlyDetected = 0
  let updated = 0
  let cleared = 0
  let unchanged = 0
  let skippedConcurrent = 0
  let failed = 0
  let lastProcessedId: string | null = resumeFrom ?? null

  console.log(
    `Starting language re-detection${dryRun ? ' (DRY-RUN)' : ''}...` +
      (resumeFrom ? ` Resuming after status: ${resumeFrom}` : '') +
      (limit ? ` Limit: ${limit}` : '')
  )

  while (true) {
    const currentBatchLimit = limit
      ? Math.min(batchSize, limit - scanned)
      : batchSize
    if (currentBatchLimit <= 0) break

    let query = knexClient('statuses')
      .leftJoin(
        'status_detected_languages',
        'statuses.id',
        'status_detected_languages.statusId'
      )
      .whereIn('statuses.type', ['Note', 'Poll'])
      .select(
        'statuses.id',
        'statuses.content',
        'statuses.updatedAt',
        'status_detected_languages.language as currentDetectedLanguage'
      )
      .orderBy('statuses.id', 'asc')
      .limit(currentBatchLimit)

    if (cursor) {
      query = query.where('statuses.id', '>', cursor)
    }

    const rows = await query
    if (rows.length === 0) break

    for (const row of rows) {
      cursor = row.id
      lastProcessedId = row.id
      scanned += 1

      try {
        let text = ''
        let declaredLanguage: string | null = null
        if (row.content) {
          try {
            const parsed = getCompatibleJSON<{
              text?: string
              language?: string | null
            }>(row.content)
            if (typeof parsed?.text === 'string') text = parsed.text
            if (typeof parsed?.language === 'string')
              declaredLanguage = parsed.language
          } catch {
            // Unparseable JSON content, leave empty text
          }
        }

        const detected = detectLanguageFromHtml(text, {
          declaredLanguage
        })
        const nextLang = detected?.language ?? null
        const currentLang = row.currentDetectedLanguage ?? null

        if (nextLang === currentLang) {
          unchanged += 1
          continue
        }

        if (dryRun) {
          if (!currentLang && nextLang) {
            console.log(
              `  [DRY-RUN] ${row.id}: newly detected '${nextLang}' (declared: '${declaredLanguage ?? 'none'}')`
            )
            newlyDetected += 1
          } else if (currentLang && nextLang) {
            console.log(
              `  [DRY-RUN] ${row.id}: updated '${currentLang}' -> '${nextLang}'`
            )
            updated += 1
          } else if (currentLang && !nextLang) {
            console.log(`  [DRY-RUN] ${row.id}: cleared (was '${currentLang}')`)
            cleared += 1
          }
          continue
        }

        // Guard against concurrent edits: verify status.updatedAt matches
        const freshStatus = await knexClient('statuses')
          .where('id', row.id)
          .first('updatedAt')

        if (
          !freshStatus ||
          new Date(freshStatus.updatedAt).getTime() !==
            new Date(row.updatedAt).getTime()
        ) {
          console.warn(
            `  [SKIP] Status ${row.id} was updated concurrently, skipping`
          )
          skippedConcurrent += 1
          continue
        }

        if (nextLang) {
          await database.setDetectedLanguage({
            statusId: row.id,
            language: nextLang,
            confidence: detected?.confidence ?? null
          })
          if (!currentLang) {
            newlyDetected += 1
          } else {
            updated += 1
          }
        } else {
          await database.clearDetectedLanguage({
            statusId: row.id
          })
          cleared += 1
        }
      } catch (err) {
        failed += 1
        console.error(`  [ERROR] Status ${row.id}: ${(err as Error).message}`)
      }
    }

    if (rows.length < currentBatchLimit) break
  }

  console.log('\nFinished language re-detection.')
  console.log(`  Scanned:            ${scanned}`)
  console.log(`  Newly detected:     ${newlyDetected}`)
  console.log(`  Updated:            ${updated}`)
  console.log(`  Cleared:            ${cleared}`)
  console.log(`  Unchanged:          ${unchanged}`)
  console.log(`  Skipped concurrent: ${skippedConcurrent}`)
  console.log(`  Failed:             ${failed}`)
  if (lastProcessedId) {
    console.log(`  Last processed ID:  ${lastProcessedId}`)
  }

  return {
    scanned,
    newlyDetected,
    updated,
    cleared,
    unchanged,
    skippedConcurrent,
    failed,
    lastProcessedId
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const database = getDatabase()
  if (!database) {
    console.error('Database is not available')
    process.exit(1)
  }

  const knexClient = getKnex()
  printDatabaseBanner()

  try {
    const result = await redetectStatusLanguages({
      database,
      knexClient,
      ...options
    })
    process.exit(result.failed > 0 ? 1 : 0)
  } finally {
    await database.destroy()
  }
}

if (process.argv[1]?.endsWith('redetectStatusLanguages.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
