#!/usr/bin/env -S node scripts/run.cjs
/**
 * Backfills blurhash placeholders and smart focal points on existing media
 * and attachment rows.
 *
 * Usage:
 *   NODE_ENV=production scripts/maintenance/backfillMediaBlurhash.ts [--dry-run] [--batch-size 50] [--force] [--local-only]
 *   NODE_ENV=production scripts/maintenance/backfillMediaBlurhash.ts --revalidate [--dry-run] [--batch-size 50]
 *
 * Options:
 *   --batch-size   Number of rows to process per batch (default: 50)
 *   --dry-run      Analyze and print planned updates without modifying the database
 *   --force        Recompute the blurhash even on rows that already have one.
 *                  Focal points are only ever filled in, never overwritten;
 *                  `docs/maintenance.md` explains why.
 *   --local-only   Never fetch a remote attachment URL; only read files this
 *                  instance stores itself
 *   --revalidate   Run the stored-blurhash repair pass INSTEAD of the backfill:
 *                  re-check every `attachments.blurhash` already in the table
 *                  and rewrite or clear the ones `decode` cannot read. Reads no
 *                  image bytes at all, so it needs neither storage nor network.
 *                  Refuses to run together with --force.
 */
import { loadEnvConfig } from '@next/env'
import { Knex } from 'knex'

import { getConfig } from '@/lib/config'
import { getDatabase, getKnex } from '@/lib/database'
import { toMediaRowId } from '@/lib/database/sql/media'
import { getMediaStorage } from '@/lib/services/medias'
import { PRESIGNED_ANALYSIS_MAX_BYTES } from '@/lib/services/medias/constants'
import {
  analyzeImageBuffer,
  normalizeBlurhash
} from '@/lib/services/medias/imageAnalysis'
import {
  MEDIA_FILE_URL_PATH,
  getMediaFileUrl,
  getMediaPathFromFileUrl
} from '@/lib/services/medias/mediaFileUrl'
import { HostRuleConfig, getCanonicalAuthority } from '@/lib/utils/host'
import { safeImageFetch } from '@/lib/utils/safeImageDownload'
import {
  SAFE_DOWNLOAD_MAX_BYTES,
  readResponseArrayBufferWithLimit
} from '@/lib/utils/streamLimit'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

// A `thumbnailUrl` an earlier version of this script wrote: the stored path
// under the files route with no scheme or authority in front of it.
const isHostRelativeMediaUrl = (value: string | null | undefined) =>
  Boolean(value?.startsWith(MEDIA_FILE_URL_PATH))

// Bounds each download's whole exchange, body stream included;
// `readResponseArrayBufferWithLimit` bounds how much of it is kept.
const REMOTE_IMAGE_TIMEOUT_MS = 10_000

export interface CliOptions {
  batchSize: number
  dryRun: boolean
  force: boolean
  localOnly: boolean
  revalidate: boolean
}

export interface InstanceHosts {
  // Host used to build a media URL when the owning actor row cannot be read.
  fallbackHost: string
  // The configured host plus `ACTIVITIES_TRUSTED_HOSTS`, in the shape
  // `getMediaPathFromFileUrl` consumes to decide whether a stored URL is ours.
  hostConfig: HostRuleConfig
}

export const parseArgs = (args: string[]): CliOptions => {
  let batchSize = 50
  let dryRun = false
  let force = false
  let localOnly = false
  let revalidate = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--force') {
      force = true
    } else if (arg === '--local-only') {
      localOnly = true
    } else if (arg === '--revalidate') {
      revalidate = true
    } else if (arg.startsWith('--batch-size=')) {
      batchSize = parseInt(arg.split('=')[1], 10) || 50
    } else if (arg === '--batch-size') {
      batchSize = parseInt(args[index + 1], 10) || 50
      index += 1
    }
  }

  return { batchSize, dryRun, force, localOnly, revalidate }
}

/**
 * The hosts this instance answers to. `trustedHosts` carries the extra domains
 * a multi-domain deployment serves, and `actors.domain` may be any of them —
 * so a stored `/api/v1/files/` URL is "ours" on any of them, not just on the
 * configured primary.
 */
export const buildInstanceHosts = (config: HostRuleConfig): InstanceHosts => ({
  // Normalised the way `getMediaFileUrl` will consume it: the configured host
  // may carry a scheme, a trailing path, or an explicit default port, none of
  // which belong in a generated URL's authority. That is exactly what the
  // matcher normalises a candidate authority to, so it is the matcher's own
  // helper rather than a second spelling of it.
  fallbackHost: getCanonicalAuthority(config.host),
  // Narrowed to the host facts on purpose: `main` hands this the whole app
  // config, and everything downstream only ever asks it the one question.
  hostConfig: { host: config.host, trustedHosts: config.trustedHosts }
})

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
 * Downloads a remote attachment image for analysis.
 *
 * The URL comes off a note a remote actor federated to us, so it is untrusted
 * input reached from INSIDE the deployment: `safeImageFetch` refuses a URL
 * naming the local network and re-checks every redirect hop, the content type
 * must claim an image, and the body is capped.
 *
 * Genuinely returns null rather than throwing — an over-large body raises
 * inside `readResponseArrayBufferWithLimit`, and swallowing it here keeps one
 * hostile row from ending the sweep AND keeps the rejection as visible as the
 * others.
 */
export const downloadRemoteImage = async (
  rawUrl: string
): Promise<Buffer | null> => {
  let response: Response | null
  try {
    response = await safeImageFetch(rawUrl)
  } catch (fetchError) {
    console.warn(`Failed to download ${rawUrl}:`, fetchError)
    return null
  }

  if (!response) {
    console.warn(`Skipping unsafe, redirected or non-HTTPS URL: ${rawUrl}`)
    return null
  }

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

  try {
    const arrayBuffer = await readResponseArrayBufferWithLimit(
      response,
      SAFE_DOWNLOAD_MAX_BYTES,
      'Remote attachment image'
    )
    return arrayBuffer.byteLength > 0 ? Buffer.from(arrayBuffer) : null
  } catch (readError) {
    console.warn(`Skipping ${rawUrl}:`, readError)
    return null
  }
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
    // still capped at the ceiling the S3 driver analyses uploads under, still
    // timed out so a stalled CDN cannot hang the sweep, and still not followed
    // anywhere: this URL is supposed to serve bytes, not redirect.
    const res = await fetch(fileOutput.redirectUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(REMOTE_IMAGE_TIMEOUT_MS)
    })
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
  // Two reasons a `mediaId` resolves to nothing, deliberately NOT summed
  // because they call for opposite responses, and an operator has to tell them
  // apart from the summary line alone.
  //
  // A media row that is GONE is the expected residue of an owner deleting their
  // own media. Its `thumbnailUrl` is unrecoverable — that rebuild reads the
  // media row's stored thumbnail path and has no other source — though the
  // BlurHash can still come from the attachment's own bytes below, because the
  // delete route drops the row even when the storage delete failed. Deleting a
  // `medias` row deliberately does not clear the `attachments.mediaId` naming
  // it, since a null `mediaId` marks a federated attachment (see AGENTS.md,
  // "Deleting Media a Post Uses"), so a row that cannot self-heal that way is
  // re-selected forever; before this it was counted in `processed` and reported
  // nowhere.
  //
  // An INVALID one was never a row id, so nothing was deleted: it is a bad
  // write, from the unvalidated `createAttachment` path AGENTS.md documents
  // under "Database Compatibility Guidelines", and is worth investigating.
  let totalDeletedMedia = 0
  let totalInvalidMediaId = 0

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
      // `whereNull('blurhash')` alone never revisits a row this script has
      // already processed — and an earlier version set the blurhash and a
      // HOST-RELATIVE thumbnailUrl in the same pass, so the rows most in need
      // of the absolute-URL repair are exactly the ones it would skip. Select
      // those too, or the fix never reaches the data it exists for.
      query = query.where((builder) =>
        builder
          .whereNull('blurhash')
          .orWhere('thumbnailUrl', 'like', `${MEDIA_FILE_URL_PATH}%`)
      )
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
          if (
            media.thumbnail &&
            (options.force ||
              !thumbnailUrl ||
              isHostRelativeMediaUrl(thumbnailUrl))
          ) {
            // Absolute, like every live path: `thumbnailUrl` is served to
            // clients as Mastodon's `preview_url` (and as a <video> poster)
            // verbatim, so a host-relative value is unusable to a native client
            // that is not talking to this origin.
            thumbnailUrl = getMediaFileUrl(
              getAttachmentMediaHost(row.actorId, instanceHosts.fallbackHost),
              media.thumbnail
            )
          }
        } else if (rowId === undefined) {
          // `toMediaRowId` refused the value, so it never named a row.
          totalInvalidMediaId += 1
          console.warn(
            `[attachments ${row.id}] mediaId ${JSON.stringify(row.mediaId)} is not a media row id; cannot restore blurhash, focus or thumbnailUrl from it`
          )
        } else {
          // A real row id whose `medias` row is gone.
          totalDeletedMedia += 1
          console.warn(
            `[attachments ${row.id}] media ${row.mediaId} no longer exists; cannot restore blurhash, focus or thumbnailUrl from it`
          )
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
          const targetPath = getMediaPathFromFileUrl(
            row.url,
            instanceHosts.hostConfig
          )
          if (targetPath) {
            buffer = await getFileBuffer(storage, targetPath)
            if (!buffer) {
              // `backfillMedias` warns for the identical case; without this the
              // local half of the sweep is the only silent one left.
              console.warn(
                `[attachments ${row.id}] Could not read file buffer at ${targetPath}`
              )
            }
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

  // Printed even when zero: a `0` rules a cause out as usefully as a non-zero
  // value names it. The counts do NOT partition `processed` — a row counted
  // here can still be repaired from its own image bytes below.
  console.log(
    `Attachments complete: processed ${totalProcessed}, updated ${totalUpdated}, ${totalDeletedMedia} whose media row is gone, ${totalInvalidMediaId} with an invalid mediaId`
  )
}

/**
 * Re-checks the blurhashes ALREADY stored on `attachments` and repairs them in
 * place, reading no image bytes at all.
 *
 * A blurhash is the one media field a remote actor supplies directly: it
 * arrives on a federated note's attachment and `createNoteJob` persists it.
 * Before #1577 the validator compared `hash.trim()` while the caller stored the
 * untrimmed original, so a whitespace-padded hash was approved and written in a
 * form `decode` throws on (`length is 29 but it should be 28`); a structurally
 * invalid one — right alphabet, right length, wrong length for the size flag in
 * its own first character, `'aaaaaa'` being the canonical example — was
 * accepted too, because the charset check never ran the blurhash package's
 * `isBlurhashValid`. That fix covers the WRITE path only. The rows already
 * written stay broken, nothing re-validates on read, and
 * `lib/types/domain/attachment.ts` re-serves the stored value verbatim to
 * third-party clients as Mastodon's `blurhash` and as a Document's `blurhash`.
 *
 * The repair needs no bytes, which is what makes this its own mode rather than
 * part of --force: a padded hash only has to be trimmed, and an unsalvageable
 * one only has to be cleared. --force answers a different question — recompute
 * this from the image — and costs a download per attachment.
 *
 * Clearing is safe, and is strictly better than leaving the value in place:
 * with a truthy blurhash `lib/components/posts/media.tsx` holds the `<img>` at
 * `opacity-0` until `onLoad`, behind a canvas a failed `decode` leaves empty,
 * so an undecodable hash shows an empty box where a NULL one falls through to a
 * bare `<img>`. It does not weaken the deleted-media placeholder promise in
 * AGENTS.md, "Deleting Media a Post Uses": that promise rests on the attachment
 * carrying a blurhash a client can actually PAINT, and a value `decode` refuses
 * never painted one.
 *
 * `medias.blurhash` is deliberately out of scope. Every value in that column
 * comes from `computeBlurhash`, i.e. from the blurhash package's own `encode`,
 * so it is canonical by construction; no path stores a peer-supplied hash
 * there.
 */
export const revalidateAttachmentBlurhashes = async (
  db: Knex,
  options: CliOptions
) => {
  console.log('--- Revalidating stored attachment blurhashes ---')
  let lastId = ''
  let totalScanned = 0
  // Reported separately, and NOT merged into one "processed" number, because
  // they call for different responses: `repaired` is residue this pass fully
  // fixed, while `cleared` is an attachment that has now lost its placeholder
  // until something recomputes one from the image bytes — a later run WITHOUT
  // --revalidate, which selects `blurhash IS NULL`, is what tries that.
  //
  // Unlike the two counts `backfillAttachments` reports, these three DO
  // partition `scanned`: every row lands in exactly one of them.
  let totalRepaired = 0
  let totalCleared = 0
  let totalUntouched = 0

  while (true) {
    // `blurhash IS NOT NULL` on purpose: a row missing one is the BACKFILL's
    // job, and this pass has no way to produce a hash. There is no `mediaType`
    // filter either — a video attachment carries the blurhash of its poster
    // frame, and the backfill's analysis step skips non-images, so this is the
    // only pass that reaches one.
    const rows = await db('attachments')
      .select('id', 'blurhash')
      .whereNotNull('blurhash')
      .where('id', '>', lastId)
      .orderBy('id', 'asc')
      .limit(options.batchSize)

    if (rows.length === 0) break
    // Keyset paging, so a row this batch just cleared out of the predicate
    // cannot shift the rows still to come.
    lastId = String(rows[rows.length - 1].id)

    for (const row of rows) {
      totalScanned += 1
      const stored = row.blurhash
      const normalized = normalizeBlurhash(stored)
      if (normalized === stored) {
        totalUntouched += 1
        continue
      }

      const prefix = options.dryRun ? '[DRY RUN] ' : ''
      if (normalized === null) {
        totalCleared += 1
        console.warn(
          `${prefix}[attachments ${row.id}] blurhash ${JSON.stringify(stored)} is not one \`decode\` can read; ${options.dryRun ? 'would clear' : 'clearing'} it`
        )
      } else {
        // The only difference `normalizeBlurhash` can make to a hash it keeps
        // is stripping surrounding whitespace — it returns the trimmed string
        // or null — so a repair is always exactly that.
        totalRepaired += 1
        console.log(
          `${prefix}[attachments ${row.id}] blurhash ${JSON.stringify(stored)} is stored padded; ${options.dryRun ? 'would rewrite' : 'rewriting'} it as ${JSON.stringify(normalized)}`
        )
      }

      if (!options.dryRun) {
        await db('attachments')
          .where('id', row.id)
          .update({ blurhash: normalized })
      }
    }
  }

  console.log(
    `Blurhash revalidation complete: scanned ${totalScanned}, repaired ${totalRepaired}, cleared ${totalCleared}, left ${totalUntouched} untouched`
  )
}

export const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  // The two modes answer opposite questions — "recompute this from the image"
  // against "repair what is already stored, touching no image" — and serving
  // both off one invocation would make the cheap one's promise untrue. Refused
  // rather than silently ordered, so an operator who asked for both finds out.
  if (options.revalidate && options.force) {
    throw new Error(
      '--revalidate and --force are separate jobs; run them one at a time'
    )
  }

  const db = getKnex()
  try {
    if (options.revalidate) {
      // Deliberately reached before the storage and host checks below: this
      // pass reads no bytes and mints no URL, so it stays usable on an instance
      // whose storage backend is unreachable or unconfigured.
      console.log(
        `Starting stored blurhash revalidation (dryRun=${options.dryRun})...`
      )
      await revalidateAttachmentBlurhashes(db, options)
      console.log('Revalidation finished successfully.')
      return
    }

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
