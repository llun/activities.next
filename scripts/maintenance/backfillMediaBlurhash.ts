#!/usr/bin/env -S node scripts/run.cjs
/**
 * Backfills blurhash placeholders and smart focal points on existing media
 * and attachment rows.
 *
 * Usage:
 *   NODE_ENV=production scripts/maintenance/backfillMediaBlurhash.ts [--dry-run] [--batch-size 50] [--force] [--local-only]
 *
 * Options:
 *   --batch-size   Number of rows to process per batch (default: 50)
 *   --dry-run      Analyze and print planned updates without modifying the database
 *   --force        Recompute the blurhash even on rows that already have one.
 *                  Focal points are only ever FILLED IN, never overwritten —
 *                  `PUT /api/v1/media/:id` lets an owner set one by hand and no
 *                  column records whether a stored point was set that way, so
 *                  recomputing would silently discard the owner's choice.
 *   --local-only   Never fetch a remote attachment URL; only read files this
 *                  instance stores itself
 */
import { loadEnvConfig } from '@next/env'
import { Knex } from 'knex'

import { getConfig } from '@/lib/config'
import { getDatabase, getKnex } from '@/lib/database'
import { toMediaRowId } from '@/lib/database/sql/media'
import { getMediaStorage } from '@/lib/services/medias'
import { PRESIGNED_ANALYSIS_MAX_BYTES } from '@/lib/services/medias/constants'
import { analyzeImageBuffer } from '@/lib/services/medias/imageAnalysis'
import { getMediaFileUrl } from '@/lib/services/medias/mediaFileUrl'
import { getSafeImageDownloadUrl } from '@/lib/utils/safeImageDownloadUrl'
import {
  SAFE_DOWNLOAD_MAX_BYTES,
  readResponseArrayBufferWithLimit
} from '@/lib/utils/streamLimit'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

// Both storage drivers serve their files from this route, so a URL under it on
// one of THIS instance's hosts names a stored path (see `getMediaFileUrl`).
const MEDIA_FILE_URL_PATH = '/api/v1/files/'

// The remote branch reads an attachment URL a federating actor put on a note.
// `AbortSignal.timeout` bounds the whole exchange including the body stream;
// `readResponseArrayBufferWithLimit` bounds how much of it is kept.
const REMOTE_IMAGE_TIMEOUT_MS = 10_000

export interface CliOptions {
  batchSize: number
  dryRun: boolean
  force: boolean
  localOnly: boolean
}

export interface InstanceHosts {
  // Host used to build a media URL when the owning actor row cannot be read.
  fallbackHost: string
  // Every authority this instance serves `/api/v1/files/` from.
  ownHosts: ReadonlySet<string>
}

export const parseArgs = (args: string[]): CliOptions => {
  let batchSize = 50
  let dryRun = false
  let force = false
  let localOnly = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--force') {
      force = true
    } else if (arg === '--local-only') {
      localOnly = true
    } else if (arg.startsWith('--batch-size=')) {
      batchSize = parseInt(arg.split('=')[1], 10) || 50
    } else if (arg === '--batch-size') {
      batchSize = parseInt(args[index + 1], 10) || 50
      index += 1
    }
  }

  return { batchSize, dryRun, force, localOnly }
}

/**
 * Canonicalises an authority for comparison. `new URL(...).host` already
 * lowercases the hostname and drops the scheme's own default port, so dropping
 * both default ports on each side is what makes a configured `example.com:443`
 * and a stored `https://example.com/...` compare equal.
 */
const canonicalAuthority = (value: string): string =>
  value
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase()
    .replace(/:(?:80|443)$/, '')

/**
 * The hosts this instance answers to. `trustedHosts` carries the extra domains
 * a multi-domain deployment serves, and `actors.domain` may be any of them —
 * so a stored `/api/v1/files/` URL is "ours" on any of them, not just on the
 * configured primary.
 */
export const buildInstanceHosts = ({
  host,
  trustedHosts
}: {
  host: string
  trustedHosts?: readonly string[] | null
}): InstanceHosts => {
  const fallbackHost = canonicalAuthority(host)
  const ownHosts = new Set(
    [host, ...(trustedHosts ?? [])]
      .map(canonicalAuthority)
      .filter((value) => value.length > 0)
  )
  return { fallbackHost, ownHosts }
}

/**
 * The host a stored media path is served from for this attachment.
 *
 * The live path builds the same URL with the OWNING actor's domain
 * (`getAttachmentMediaMetadata` is handed `currentActor.domain`), which on a
 * multi-domain instance is not necessarily the configured primary host. An
 * `actorId` is that actor's URL, so its authority IS that domain — this is not
 * `getActorDomain`, though, because that helper echoes a non-URL `actorId`
 * back verbatim, and minting `https://<garbage>/api/v1/files/...` is worse
 * than falling back to the host we know we serve.
 */
export const getAttachmentMediaHost = (
  actorId: string | null | undefined,
  fallbackHost: string
): string => {
  if (!actorId) return fallbackHost
  try {
    return new URL(actorId).host || fallbackHost
  } catch {
    return fallbackHost
  }
}

/**
 * Recovers the stored path from an attachment URL, or null when the URL is not
 * one of ours.
 *
 * The host check is the point: `/api/v1/files/` is this project's own route, so
 * every OTHER activities.next instance serves attachment URLs with exactly that
 * path. Matching on the path alone treated a remote instance's URL as a local
 * storage path, which then missed in storage and skipped the row.
 */
const getOwnPathname = (
  rawUrl: string,
  ownHosts: ReadonlySet<string>
): string | null => {
  // A host-relative URL can only be served by this instance.
  if (rawUrl.startsWith('/')) return rawUrl.split(/[?#]/)[0]

  try {
    const parsed = new URL(rawUrl)
    if (!ownHosts.has(canonicalAuthority(parsed.host))) return null
    return parsed.pathname
  } catch {
    return null
  }
}

export const getLocalStoragePath = (
  rawUrl: string,
  ownHosts: ReadonlySet<string>
): string | null => {
  const pathname = getOwnPathname(rawUrl, ownHosts)
  if (!pathname?.startsWith(MEDIA_FILE_URL_PATH)) return null

  const encodedPath = pathname.slice(MEDIA_FILE_URL_PATH.length)
  if (!encodedPath) return null

  try {
    return decodeURIComponent(encodedPath)
  } catch {
    return encodedPath
  }
}

/**
 * Downloads a remote attachment image for analysis.
 *
 * The URL comes off a note a remote actor federated to us, so it is untrusted
 * input reached from INSIDE the deployment: the guard rejects a URL naming the
 * local network before the request is made, the content type must claim an
 * image, and the body is capped. Returns null (never throws) so one hostile row
 * cannot end the sweep.
 */
export const downloadRemoteImage = async (
  rawUrl: string
): Promise<Buffer | null> => {
  const safeUrl = await getSafeImageDownloadUrl(rawUrl)
  if (!safeUrl) {
    console.warn(`Skipping unsafe or non-HTTPS attachment URL: ${rawUrl}`)
    return null
  }

  const response = await fetch(safeUrl, {
    signal: AbortSignal.timeout(REMOTE_IMAGE_TIMEOUT_MS)
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    console.warn(`Failed to download ${rawUrl}: HTTP ${response.status}`)
    return null
  }

  const contentType =
    response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ??
    ''
  if (!contentType.startsWith('image/')) {
    await response.body?.cancel().catch(() => undefined)
    console.warn(
      `Skipping ${rawUrl}: content type is ${contentType || 'unset'}, not an image`
    )
    return null
  }

  const arrayBuffer = await readResponseArrayBufferWithLimit(
    response,
    SAFE_DOWNLOAD_MAX_BYTES,
    'Remote attachment image'
  )
  return arrayBuffer.byteLength > 0 ? Buffer.from(arrayBuffer) : null
}

export const getFileBuffer = async (
  storage: NonNullable<ReturnType<typeof getMediaStorage>>,
  targetPath: string
): Promise<Buffer | null> => {
  const fileOutput = await storage.getFile(targetPath)
  if (!fileOutput) return null
  if (fileOutput.type === 'buffer') return fileOutput.buffer
  if (fileOutput.type === 'redirect') {
    // Our own presigned URL rather than untrusted input, so no SSRF guard — but
    // still capped, at the same ceiling the S3 driver analyses uploads under.
    const res = await fetch(fileOutput.redirectUrl)
    if (res.ok) {
      return Buffer.from(
        await readResponseArrayBufferWithLimit(
          res,
          PRESIGNED_ANALYSIS_MAX_BYTES,
          'Stored media file'
        )
      )
    }
    await res.body?.cancel().catch(() => undefined)
  }
  return null
}

export const backfillMedias = async (
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

        // Collected field by field so a --force pass that recomputes an
        // unchanged blurhash still fills in a focal point the row is missing,
        // and so a row where nothing changed is not counted as updated.
        const updates: Record<string, unknown> = {}
        if (analysis.blurhash && analysis.blurhash !== row.blurhash) {
          updates.blurhash = analysis.blurhash
        }
        if (
          (row.focusX === null || row.focusY === null) &&
          analysis.focus !== null
        ) {
          updates.focusX = analysis.focus.x
          updates.focusY = analysis.focus.y
        }

        if (Object.keys(updates).length === 0) continue

        totalUpdated += 1
        if (options.dryRun) {
          console.log(
            `[DRY RUN] [medias ${row.id}] would update ${JSON.stringify(updates)}`
          )
        } else {
          await db('medias').where('id', row.id).update(updates)
          console.log(
            `[medias ${row.id}] updated ${Object.keys(updates).join(', ')}`
          )
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

export const backfillAttachments = async (
  db: Knex,
  storage: NonNullable<ReturnType<typeof getMediaStorage>>,
  options: CliOptions,
  instanceHosts: InstanceHosts
) => {
  console.log('--- Backfilling attachments table ---')
  let lastId = ''
  let totalProcessed = 0
  let totalUpdated = 0

  while (true) {
    let query = db('attachments')
      .select(
        'id',
        'actorId',
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

      // 1. If mediaId is present, check corresponding medias row. The media row
      // is the source of truth for a local upload, and `backfillMedias` has
      // already refreshed it in this same run, so under --force it wins.
      let blurhashFromMedia = false
      if (row.mediaId) {
        const rowId = mediaIdMap.get(row.mediaId)
        const media = rowId !== undefined ? mediaMap.get(rowId) : undefined

        if (media) {
          if (media.blurhash && (options.force || !blurhash)) {
            blurhash = media.blurhash
            blurhashFromMedia = true
          }
          if (media.focusX !== null && focusX === null) focusX = media.focusX
          if (media.focusY !== null && focusY === null) focusY = media.focusY
          if (media.thumbnail && (options.force || !thumbnailUrl)) {
            // Absolute, like every live path: `thumbnailUrl` is served to
            // clients as Mastodon's `preview_url` (and as a <video> poster)
            // verbatim, so a host-relative value is unusable to a native client
            // that is not talking to this origin.
            thumbnailUrl = getMediaFileUrl(
              getAttachmentMediaHost(row.actorId, instanceHosts.fallbackHost),
              media.thumbnail
            )
          }
        }
      }

      // 2. If the blurhash is still missing on an image attachment — or --force
      // asked for a recompute and no media row supplied one — analyze the image
      // directly.
      const shouldAnalyze =
        (!blurhash || (options.force && !blurhashFromMedia)) &&
        row.mediaType?.startsWith('image') &&
        row.url
      if (shouldAnalyze) {
        try {
          let buffer: Buffer | null = null
          const targetPath = getLocalStoragePath(
            row.url,
            instanceHosts.ownHosts
          )
          if (targetPath) {
            buffer = await getFileBuffer(storage, targetPath)
          } else if (!options.localOnly) {
            buffer = await downloadRemoteImage(row.url)
          }

          if (buffer) {
            const analysis = await analyzeImageBuffer(buffer, {
              manualFocus:
                focusX !== null && focusY !== null
                  ? { x: Number(focusX), y: Number(focusY) }
                  : null
            })
            if (analysis.blurhash) {
              blurhash = analysis.blurhash
            }
            if (analysis.focus && focusX === null && focusY === null) {
              focusX = analysis.focus.x
              focusY = analysis.focus.y
            }
          }
        } catch (err) {
          console.warn(`[attachments ${row.id}] analysis failed:`, err)
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

  const config = getConfig()
  const instanceHosts = buildInstanceHosts(config)
  if (!instanceHosts.fallbackHost) {
    throw new Error('ACTIVITIES_HOST is not configured')
  }

  console.log(
    `Starting media blurhash backfill (dryRun=${options.dryRun}, force=${options.force}, localOnly=${options.localOnly})...`
  )
  try {
    await backfillMedias(db, storage, options)
    await backfillAttachments(db, storage, options, instanceHosts)
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
