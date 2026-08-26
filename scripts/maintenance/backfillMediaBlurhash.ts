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
 *                  Focal points are only ever filled in, never overwritten;
 *                  `docs/maintenance.md` explains why.
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
import {
  getMediaFileUrl,
  isTraversingStoragePath
} from '@/lib/services/medias/mediaFileUrl'
import {
  getTrustedHostRules,
  hostMatchesRule,
  normalizeHost
} from '@/lib/utils/host'
import { safeImageFetch } from '@/lib/utils/safeImageDownload'
import {
  SAFE_DOWNLOAD_MAX_BYTES,
  readResponseArrayBufferWithLimit
} from '@/lib/utils/streamLimit'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

// Both storage drivers serve their files from this route, so a URL under it on
// one of THIS instance's hosts names a stored path (see `getMediaFileUrl`).
const MEDIA_FILE_URL_PATH = '/api/v1/files/'

// Only ever used to resolve a host-relative URL; a resolved URL that still
// carries this authority is one that brought none of its own.
const PLACEHOLDER_HOST = 'placeholder.invalid'

// A `thumbnailUrl` an earlier version of this script wrote: the stored path
// under the files route with no scheme or authority in front of it.
const isHostRelativeMediaUrl = (value: string | null | undefined) =>
  Boolean(value?.startsWith(MEDIA_FILE_URL_PATH))
const PLACEHOLDER_ORIGIN = `https://${PLACEHOLDER_HOST}`

// Bounds each download's whole exchange, body stream included;
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
  // Every authority this instance serves `/api/v1/files/` from, as the same
  // rule list `isHostTrustedByRules` consumes — so a `*.example.com` entry
  // matches the way it does everywhere else in the app.
  ownHostRules: readonly string[]
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
 * Whether a URL's authority is one this instance serves.
 *
 * `normalizeHost` + `hostMatchesRule` are the app's own matcher (the pair
 * behind `isHostTrustedByRules`), so a wildcard `ACTIVITIES_TRUSTED_HOSTS`
 * entry like `*.example.com` matches a real subdomain here as it does for a
 * request Host header. `isHostTrustedByRules` itself is not reused because
 * `normalizeHost` deliberately answers null for loopback names, which would
 * make a dev instance on `localhost:3000` fail to recognise its own storage
 * URLs — so a loopback authority falls back to literal equality.
 */
const isOwnAuthority = (
  authority: string,
  ownHostRules: readonly string[]
): boolean => {
  const normalizedHost = normalizeHost(authority, { allowWildcard: false })
  if (normalizedHost) {
    return ownHostRules.some((rule) => {
      const normalizedRule = normalizeHost(rule)
      return normalizedRule
        ? hostMatchesRule(normalizedHost, normalizedRule)
        : false
    })
  }

  // `normalizeHost` refused this authority. That is mostly loopback, which it
  // rejects by design, so compare those raw — but a `*.`-prefixed rule is a
  // PATTERN, never a host, and `new URL` happily parses `*` in an authority.
  // Comparing it literally let a federated attachment url of
  // `https://*.<trusted-domain>/api/v1/files/<path>` match the rule's own
  // spelling and read an attacker-chosen path straight out of local storage.
  const candidate = authority.trim().toLowerCase()
  if (!candidate || candidate.startsWith('*.')) return false
  return ownHostRules.some((rule) => {
    const normalizedRule = rule.trim().toLowerCase()
    return !normalizedRule.startsWith('*.') && normalizedRule === candidate
  })
}

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
}): InstanceHosts => ({
  // Normalised the way `getMediaFileUrl` will consume it: the configured host
  // may carry a scheme, a trailing path, or an explicit default port, none of
  // which belong in a generated URL's authority.
  fallbackHost: host
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase()
    .replace(/:(?:80|443)$/, ''),
  ownHostRules: getTrustedHostRules({
    host,
    trustedHosts: trustedHosts ?? []
  }).filter((rule) => rule.trim().length > 0)
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
  ownHostRules: readonly string[]
): string | null => {
  // A host-relative URL can only be served by this instance. Resolve it against
  // a placeholder origin so `..` segments are normalised away exactly as they
  // are on the absolute branch — reading it as a raw string was not.
  //
  // Whether it kept that origin is what decides it, NOT the leading characters:
  // a raw `!startsWith('//')` test is defeated because the WHATWG parser grows
  // an authority out of inputs that do not begin with `//` — it reads `\` as
  // `/` for a special scheme, and strips tab, LF and CR from the input before
  // parsing at all, so `/\evil.example/…` and `/<TAB>/evil.example/…` are both
  // protocol-relative.
  if (rawUrl.startsWith('/')) {
    try {
      const resolved = new URL(rawUrl, PLACEHOLDER_ORIGIN)
      return resolved.host === PLACEHOLDER_HOST ? resolved.pathname : null
    } catch {
      return null
    }
  }

  try {
    const parsed = new URL(rawUrl)
    return isOwnAuthority(parsed.host, ownHostRules) ? parsed.pathname : null
  } catch {
    return null
  }
}

export const getLocalStoragePath = (
  rawUrl: string,
  ownHostRules: readonly string[]
): string | null => {
  const pathname = getOwnPathname(rawUrl, ownHostRules)
  if (!pathname?.startsWith(MEDIA_FILE_URL_PATH)) return null

  const encodedPath = pathname.slice(MEDIA_FILE_URL_PATH.length)
  if (!encodedPath) return null

  let storagePath: string
  try {
    storagePath = decodeURIComponent(encodedPath)
  } catch {
    storagePath = encodedPath
  }

  return isTraversingStoragePath(storagePath) ? null : storagePath
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
          const targetPath = getLocalStoragePath(
            row.url,
            instanceHosts.ownHostRules
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
