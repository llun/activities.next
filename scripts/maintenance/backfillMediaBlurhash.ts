#!/usr/bin/env -S node scripts/run.cjs
/**
 * Backfills blurhash placeholders and smart focal points on existing media
 * and attachment rows.
 *
 * Usage:
 *   NODE_ENV=production scripts/maintenance/backfillMediaBlurhash.ts [--dry-run] [--batch-size 50] [--force]
 *
 * Options:
 *   --batch-size   Number of rows to process per batch (default: 50)
 *   --dry-run      Analyze and print planned updates without modifying the database
 *   --force        Recompute blurhash/focus even on rows that already have them
 */
import { loadEnvConfig } from '@next/env'
import { Knex } from 'knex'

import { getDatabase, getKnex } from '@/lib/database'
import { toMediaRowId } from '@/lib/database/sql/media'
import { getMediaStorage } from '@/lib/services/medias'
import { analyzeImageBuffer } from '@/lib/services/medias/imageAnalysis'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

interface CliOptions {
  batchSize: number
  dryRun: boolean
  force: boolean
}

const parseArgs = (args: string[]): CliOptions => {
  let batchSize = 50
  let dryRun = false
  let force = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--force') {
      force = true
    } else if (arg.startsWith('--batch-size=')) {
      batchSize = parseInt(arg.split('=')[1], 10) || 50
    } else if (arg === '--batch-size') {
      batchSize = parseInt(args[index + 1], 10) || 50
      index += 1
    }
  }

  return { batchSize, dryRun, force }
}

const getFileBuffer = async (
  storage: NonNullable<ReturnType<typeof getMediaStorage>>,
  targetPath: string
): Promise<Buffer | null> => {
  const fileOutput = await storage.getFile(targetPath)
  if (!fileOutput) return null
  if (fileOutput.type === 'buffer') return fileOutput.buffer
  if (fileOutput.type === 'redirect') {
    const res = await fetch(fileOutput.redirectUrl)
    if (res.ok) {
      return Buffer.from(await res.arrayBuffer())
    }
  }
  return null
}

const backfillMedias = async (
  db: Knex,
  storage: NonNullable<ReturnType<typeof getMediaStorage>>,
  options: CliOptions
) => {
  console.log('--- Backfilling medias table ---')
  let lastId = 0
  let totalProcessed = 0
  let totalUpdated = 0

  while (true) {
    let query = db('medias')
      .select(
        'id',
        'original',
        'originalMimeType',
        'thumbnail',
        'focusX',
        'focusY',
        'blurhash'
      )
      .where('id', '>', lastId)
      .orderBy('id', 'asc')
      .limit(options.batchSize)

    if (!options.force) {
      query = query.whereNull('blurhash')
    }

    const rows = await query
    if (rows.length === 0) break
    lastId = Number(rows[rows.length - 1].id)

    for (const row of rows) {
      totalProcessed += 1
      const isVideo = row.originalMimeType?.startsWith('video')
      const targetPath = isVideo && row.thumbnail ? row.thumbnail : row.original

      if (!targetPath) continue

      try {
        const buffer = await getFileBuffer(storage, targetPath)
        if (!buffer) {
          console.warn(
            `[medias ${row.id}] Could not read file buffer at ${targetPath}`
          )
          continue
        }

        const analysis = await analyzeImageBuffer(buffer, {
          manualFocus:
            row.focusX !== null && row.focusY !== null
              ? { x: Number(row.focusX), y: Number(row.focusY) }
              : null
        })

        if (analysis.blurhash) {
          totalUpdated += 1
          if (options.dryRun) {
            console.log(
              `[DRY RUN] [medias ${row.id}] would set blurhash=${analysis.blurhash}, focus=${JSON.stringify(analysis.focus)}`
            )
          } else {
            const updates: Record<string, unknown> = {
              blurhash: analysis.blurhash
            }
            if (row.focusX === null || row.focusY === null) {
              if (analysis.focus) {
                updates.focusX = analysis.focus.x
                updates.focusY = analysis.focus.y
              }
            }
            await db('medias').where('id', row.id).update(updates)
            console.log(
              `[medias ${row.id}] updated blurhash=${analysis.blurhash}`
            )
          }
        }
      } catch (err) {
        console.error(`[medias ${row.id}] error processing:`, err)
      }
    }
  }

  console.log(
    `Medias complete: processed ${totalProcessed}, updated ${totalUpdated}`
  )
}

const backfillAttachments = async (
  db: Knex,
  _storage: NonNullable<ReturnType<typeof getMediaStorage>>,
  options: CliOptions
) => {
  console.log('--- Backfilling attachments table ---')
  let lastId = ''
  let totalProcessed = 0
  let totalUpdated = 0

  while (true) {
    let query = db('attachments')
      .select(
        'id',
        'mediaId',
        'url',
        'mediaType',
        'blurhash',
        'focusX',
        'focusY',
        'thumbnailUrl'
      )
      .where('id', '>', lastId)
      .orderBy('id', 'asc')
      .limit(options.batchSize)

    if (!options.force) {
      query = query.whereNull('blurhash')
    }

    const rows = await query
    if (rows.length === 0) break
    lastId = String(rows[rows.length - 1].id)

    // Batch resolve medias for attachments that reference a numeric mediaId
    const mediaIdMap = new Map<string, number>()
    for (const row of rows) {
      if (row.mediaId) {
        const rowId = toMediaRowId(row.mediaId)
        if (rowId !== null) {
          mediaIdMap.set(row.mediaId, rowId)
        }
      }
    }

    const mediaRows =
      mediaIdMap.size > 0
        ? await db('medias')
            .whereIn('id', Array.from(mediaIdMap.values()))
            .select('id', 'blurhash', 'focusX', 'focusY', 'thumbnail')
        : []
    const mediaMap = new Map(mediaRows.map((m) => [m.id, m]))

    for (const row of rows) {
      totalProcessed += 1
      let blurhash = row.blurhash
      let focusX = row.focusX
      let focusY = row.focusY
      let thumbnailUrl = row.thumbnailUrl

      // 1. If mediaId is present, check corresponding medias row
      if (row.mediaId) {
        const rowId = mediaIdMap.get(row.mediaId)
        const media = rowId !== undefined ? mediaMap.get(rowId) : undefined

        if (media) {
          if (media.blurhash && !blurhash) blurhash = media.blurhash
          if (media.focusX !== null && focusX === null) focusX = media.focusX
          if (media.focusY !== null && focusY === null) focusY = media.focusY
          if (media.thumbnail && !thumbnailUrl) {
            thumbnailUrl = `/api/v1/files/${media.thumbnail}`
          }
        }
      }

      if (
        blurhash !== row.blurhash ||
        focusX !== row.focusX ||
        focusY !== row.focusY ||
        thumbnailUrl !== row.thumbnailUrl
      ) {
        totalUpdated += 1
        if (options.dryRun) {
          console.log(
            `[DRY RUN] [attachments ${row.id}] would update blurhash=${blurhash}, focusX=${focusX}, focusY=${focusY}, thumbnailUrl=${thumbnailUrl}`
          )
        } else {
          await db('attachments').where('id', row.id).update({
            blurhash,
            focusX,
            focusY,
            thumbnailUrl
          })
          console.log(`[attachments ${row.id}] updated`)
        }
      }
    }
  }

  console.log(
    `Attachments complete: processed ${totalProcessed}, updated ${totalUpdated}`
  )
}

export const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  const db = getKnex()
  const database = getDatabase()
  if (!database) {
    throw new Error('Database connection failed')
  }
  const storage = getMediaStorage(database)
  if (!storage) {
    throw new Error('Media storage backend is not configured')
  }

  console.log(
    `Starting media blurhash backfill (dryRun=${options.dryRun}, force=${options.force})...`
  )
  try {
    await backfillMedias(db, storage, options)
    await backfillAttachments(db, storage, options)
    console.log('Backfill finished successfully.')
  } finally {
    await db.destroy()
  }
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((err) => {
    console.error('Fatal error in backfill:', err)
    process.exit(1)
  })
}
