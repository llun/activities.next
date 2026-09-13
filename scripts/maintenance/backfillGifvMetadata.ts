#!/usr/bin/env -S node scripts/run.cjs
/**
 * Backfills GIFV playback metadata on existing video attachments.
 *
 * Resolves authoritative status details from Mastodon instances and records
 * `playbackType: 'gifv' | 'video'` plus `thumbnailUrl` if missing.
 *
 * Usage:
 *   NODE_ENV=production scripts/maintenance/backfillGifvMetadata.ts [--dry-run] [--batch-size 50]
 *
 * Options:
 *   --dry-run      Analyze and print planned updates without modifying the database
 *   --batch-size   Number of rows to process per batch (default: 50)
 */
import { loadEnvConfig } from '@next/env'

import { getKnex } from '@/lib/database'
import { resolveAnimationMetadata } from '@/lib/services/medias/animationMetadata'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

export interface CliOptions {
  dryRun: boolean
  batchSize: number
}

export const parseArgs = (args: string[]): CliOptions => {
  let dryRun = false
  let batchSize = 50

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--batch-size' && i + 1 < args.length) {
      const parsed = Number.parseInt(args[++i], 10)
      if (!Number.isNaN(parsed) && parsed > 0) {
        batchSize = parsed
      }
    }
  }

  return { dryRun, batchSize }
}

export const runBackfill = async (options: CliOptions) => {
  const knex = getKnex()
  if (!knex) {
    throw new Error('Database is not initialized')
  }

  const { dryRun, batchSize } = options
  console.log(
    `Starting GIFV metadata backfill (batchSize: ${batchSize}, dryRun: ${dryRun})...`
  )

  let processed = 0
  let updated = 0
  let failed = 0
  let lastId: string | null = null

  while (true) {
    let query = knex('attachments')
      .where('mediaType', 'like', 'video%')
      .whereNull('playbackType')
      .orderBy('id', 'asc')
      .limit(batchSize)

    if (lastId) {
      query = query.where('id', '>', lastId)
    }

    const attachments = await query
    if (attachments.length === 0) {
      break
    }

    for (const attachment of attachments) {
      lastId = attachment.id
      processed++
      try {
        const status = await knex('statuses')
          .where('id', attachment.statusId)
          .first()

        const statusUrl = status?.url || attachment.statusId
        const statusId = attachment.statusId
        const authorId = status?.actorId || attachment.actorId

        const resolved = await resolveAnimationMetadata({
          statusUrl,
          statusId,
          authorId,
          attachments: [
            {
              url: attachment.url,
              mediaType: attachment.mediaType
            }
          ]
        })

        const item = resolved[attachment.url]
        const playbackType =
          item && item.playbackType !== 'unknown'
            ? item.playbackType
            : 'unknown'
        const thumbnailUrl =
          !attachment.thumbnailUrl && item?.previewUrl
            ? item.previewUrl
            : undefined

        console.log(
          `[${attachment.id}] URL: ${attachment.url} -> playbackType: ${playbackType}${thumbnailUrl ? ` (thumbnail: ${thumbnailUrl})` : ''}`
        )

        if (!dryRun) {
          const updates: Record<string, unknown> = { playbackType }
          if (thumbnailUrl) {
            updates.thumbnailUrl = thumbnailUrl
          }
          await knex('attachments').where('id', attachment.id).update(updates)
        }

        updated++
      } catch (err) {
        failed++
        console.error(`Error processing attachment ${attachment.id}:`, err)
      }
    }
  }

  console.log('Backfill summary:')
  console.log(`  Processed: ${processed}`)
  console.log(`  Updated:   ${updated}`)
  console.log(`  Failed:    ${failed}`)
}

if (process.argv[1]?.includes('backfillGifvMetadata')) {
  const options = parseArgs(process.argv.slice(2))
  runBackfill(options)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Backfill failed:', err)
      process.exit(1)
    })
}
