#!/usr/bin/env -S node scripts/run.cjs
/**
 * Generates alt text (descriptions) for existing images in the database that
 * have filenames starting with `IMG_` or ending with `.jpeg` and are missing alt text.
 *
 * Usage:
 *   NODE_ENV=production scripts/maintenance/generateAltTextForOldImages.ts [--dry-run] [--batch-size 50] [--limit 100]
 *
 * Options:
 *   --dry-run      Analyze and print planned updates without modifying the database
 *   --batch-size   Number of rows to fetch per batch (default: 50)
 *   --limit        Maximum total number of media/attachment records to process
 */
import { loadEnvConfig } from '@next/env'
import { Knex } from 'knex'

import { getConfig } from '@/lib/config'
import { getDatabase, getKnex } from '@/lib/database'
import { generateAltText } from '@/lib/services/altText/openai'
import { getMediaStorage } from '@/lib/services/medias'
import { getMediaPathFromFileUrl } from '@/lib/services/medias/mediaFileUrl'

import {
  buildInstanceHosts,
  downloadRemoteImage,
  getFileBuffer
} from './backfillMediaBlurhash'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

export interface CliOptions {
  batchSize: number
  dryRun: boolean
  limit?: number
}

export const parseArgs = (args: string[]): CliOptions => {
  let batchSize = 50
  let dryRun = false
  let limit: number | undefined

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--dry-run') {
      dryRun = true
    } else if (arg.startsWith('--batch-size=')) {
      batchSize = parseInt(arg.split('=')[1], 10) || 50
    } else if (arg === '--batch-size') {
      batchSize = parseInt(args[index + 1], 10) || 50
      index += 1
    } else if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10) || undefined
    } else if (arg === '--limit') {
      limit = parseInt(args[index + 1], 10) || undefined
      index += 1
    }
  }

  return { batchSize, dryRun, limit }
}

/**
 * Helper to check if a file path or URL matches our target criteria:
 * starts with `IMG_` or ends with `.jpeg` (case-insensitive).
 */
export const matchesTargetPattern = (
  pathOrUrl: string | null | undefined
): boolean => {
  if (!pathOrUrl) return false
  const filename = pathOrUrl.split('/').pop()?.toLowerCase() ?? ''
  return filename.startsWith('img_') || filename.endsWith('.jpeg')
}

export const processMediasTable = async (
  db: Knex,
  storage: NonNullable<ReturnType<typeof getMediaStorage>>,
  altTextConfig: NonNullable<ReturnType<typeof getConfig>['altText']>,
  options: CliOptions
) => {
  console.log('--- Checking medias table for missing alt text ---')
  let lastId = 0
  let totalProcessed = 0
  let totalUpdated = 0

  while (true) {
    if (options.limit && totalProcessed >= options.limit) break

    const fetchSize = options.limit
      ? Math.min(options.batchSize, options.limit - totalProcessed)
      : options.batchSize

    const rows = await db('medias')
      .select('id', 'original', 'originalMimeType', 'description')
      .where('id', '>', lastId)
      .where((builder) =>
        builder.whereNull('description').orWhere('description', '')
      )
      .orderBy('id', 'asc')
      .limit(fetchSize)

    if (rows.length === 0) break
    lastId = Number(rows[rows.length - 1].id)

    for (const row of rows) {
      if (options.limit && totalProcessed >= options.limit) break

      if (!matchesTargetPattern(row.original)) {
        continue
      }

      totalProcessed += 1

      try {
        const buffer = await getFileBuffer(storage, row.original)
        if (!buffer) {
          console.warn(
            `[medias ${row.id}] Could not read file buffer at ${row.original}`
          )
          continue
        }

        const mimeType = row.originalMimeType || 'image/jpeg'
        const generatedAltText = await generateAltText(
          altTextConfig,
          buffer,
          mimeType
        )

        if (!generatedAltText) {
          console.warn(`[medias ${row.id}] Failed to generate alt text`)
          continue
        }

        totalUpdated += 1
        if (options.dryRun) {
          console.log(
            `[DRY RUN] [medias ${row.id}] would update description: ${JSON.stringify(generatedAltText)}`
          )
        } else {
          const now = new Date()
          await db('medias').where('id', row.id).update({
            description: generatedAltText,
            updatedAt: now
          })

          // Also update linked attachments that currently have no alt text
          const updatedAttachments = await db('attachments')
            .where('mediaId', String(row.id))
            .where((builder) => builder.whereNull('name').orWhere('name', ''))
            .update({
              name: generatedAltText,
              updatedAt: now
            })

          console.log(
            `[medias ${row.id}] updated description and ${updatedAttachments} linked attachment(s)`
          )
        }
      } catch (err) {
        console.error(`[medias ${row.id}] Error generating alt text:`, err)
      }
    }
  }

  console.log(
    `Medias complete: processed ${totalProcessed}, updated ${totalUpdated}`
  )
}

export const processAttachmentsTable = async (
  db: Knex,
  storage: NonNullable<ReturnType<typeof getMediaStorage>>,
  altTextConfig: NonNullable<ReturnType<typeof getConfig>['altText']>,
  options: CliOptions,
  hostConfig: ReturnType<typeof buildInstanceHosts>['hostConfig']
) => {
  console.log('--- Checking attachments table for missing alt text ---')
  let lastId = ''
  let totalProcessed = 0
  let totalUpdated = 0

  while (true) {
    if (options.limit && totalProcessed >= options.limit) break

    const fetchSize = options.limit
      ? Math.min(options.batchSize, options.limit - totalProcessed)
      : options.batchSize

    const rows = await db('attachments')
      .select('id', 'url', 'mediaType', 'name')
      .where('id', '>', lastId)
      .where((builder) => builder.whereNull('name').orWhere('name', ''))
      .orderBy('id', 'asc')
      .limit(fetchSize)

    if (rows.length === 0) break
    lastId = String(rows[rows.length - 1].id)

    for (const row of rows) {
      if (options.limit && totalProcessed >= options.limit) break

      if (!matchesTargetPattern(row.url)) {
        continue
      }

      totalProcessed += 1

      try {
        let buffer: Buffer | null = null
        const targetPath = getMediaPathFromFileUrl(row.url, hostConfig)
        if (targetPath) {
          buffer = await getFileBuffer(storage, targetPath)
        } else {
          buffer = await downloadRemoteImage(row.url)
        }

        if (!buffer) {
          console.warn(
            `[attachments ${row.id}] Could not read file buffer for ${row.url}`
          )
          continue
        }

        const mimeType = row.mediaType || 'image/jpeg'
        const generatedAltText = await generateAltText(
          altTextConfig,
          buffer,
          mimeType
        )

        if (!generatedAltText) {
          console.warn(`[attachments ${row.id}] Failed to generate alt text`)
          continue
        }

        totalUpdated += 1
        if (options.dryRun) {
          console.log(
            `[DRY RUN] [attachments ${row.id}] would update name: ${JSON.stringify(generatedAltText)}`
          )
        } else {
          await db('attachments').where('id', row.id).update({
            name: generatedAltText,
            updatedAt: new Date()
          })
          console.log(`[attachments ${row.id}] updated name`)
        }
      } catch (err) {
        console.error(`[attachments ${row.id}] Error generating alt text:`, err)
      }
    }
  }

  console.log(
    `Attachments complete: processed ${totalProcessed}, updated ${totalUpdated}`
  )
}

export const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  const config = getConfig()

  if (!config.altText) {
    console.error(
      'Alt text generation is not configured. Please set ACTIVITIES_ALT_TEXT_* environment variables.'
    )
    process.exit(1)
  }

  const db = getKnex()
  try {
    const database = getDatabase()
    if (!database) {
      throw new Error('Database connection failed')
    }
    const storage = getMediaStorage(database)
    if (!storage) {
      throw new Error('Media storage backend is not configured')
    }

    const instanceHosts = buildInstanceHosts(config)

    console.log(
      `Starting alt text generation for old images (dryRun=${options.dryRun}, batchSize=${options.batchSize}${options.limit ? `, limit=${options.limit}` : ''})...`
    )

    await processMediasTable(db, storage, config.altText, options)
    await processAttachmentsTable(
      db,
      storage,
      config.altText,
      options,
      instanceHosts.hostConfig
    )

    console.log('Alt text generation finished successfully.')
  } finally {
    await db.destroy()
  }
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((err) => {
    console.error('Fatal error in generateAltTextForOldImages:', err)
    process.exit(1)
  })
}
