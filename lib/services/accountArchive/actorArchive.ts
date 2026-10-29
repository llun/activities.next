/**
 * The reusable core of the actor archive: the Mastodon-shaped builders, the
 * streaming collection writers and the paged readers shared by the operator
 * CLI (scripts/backup/actorArchive.ts, tar.gz) and the user-facing account
 * export (lib/services/accountArchive/, zip).
 *
 * Nothing here prints or reads the process arguments; the CLI keeps those.
 */
import crypto from 'crypto'
import { createWriteStream } from 'fs'
import fs from 'fs/promises'
import path from 'path'

import { NOTE_ACTIVITY_CONTEXT } from '@/lib/activities/noteContext'
import { encodeFavouriteCursor } from '@/lib/database/domains/like/favouriteCursor'
import { Database } from '@/lib/database/types'
import { getMediaPathFromFileUrl } from '@/lib/services/medias/mediaFileUrl'
import { resolveStorageFilePath } from '@/lib/services/medias/storagePath'
import {
  AnnounceAction,
  CreateAction
} from '@/lib/types/activitypub/activities'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { Like, StatusEditRevision } from '@/lib/types/database/operations'
import {
  Attachment,
  getDocumentFromAttachment
} from '@/lib/types/domain/attachment'
import { Bookmark } from '@/lib/types/domain/bookmark'
import { Follow } from '@/lib/types/domain/follow'
import {
  Status,
  StatusType,
  toActivityPubObject
} from '@/lib/types/domain/status'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { HostRuleConfig } from '@/lib/utils/host'
import { safeImageFetch } from '@/lib/utils/safeImageDownload'
import { readResponseArrayBufferWithLimit } from '@/lib/utils/streamLimit'

export const MEDIA_ARCHIVE_DIR = 'media_attachments/files'
export const REMOTE_MEDIA_ARCHIVE_DIR = 'media_attachments/remote'
/**
 * How long ONE remote attachment may take in total — every redirect hop, its
 * headers and its body — enforced as an overall deadline passed to
 * `safeImageFetch` alongside the same value as its per-hop timeout.
 *
 * Deliberately much larger than `PUBLIC_STORAGE_FETCH_TIMEOUT_MS`, because a
 * timeout that bounds the body is also a throughput floor: at 60s, reaching
 * even the default 200 MiB cap would have required a sustained 3.5 MB/s, so a
 * large federated video on an ordinary link would have been dropped from the
 * archive that used to contain it — silent data loss in a backup. Ten minutes
 * puts that floor near 350 KB/s at the default cap.
 *
 * It has to be a DEADLINE and not just a per-hop timeout, because these URLs
 * are owner-supplied and the export walks them one after another with no cap
 * on how many a status carries: per-hop alone, a host stalling at every hop
 * costs this times `MAX_SAFE_IMAGE_REDIRECTS + 1`. Their SUM is bounded
 * separately, by `DEFAULT_REMOTE_FETCH_BUDGET_SECONDS`; this one is per
 * attachment, and because the budget never aborts a download it has already
 * started, the two add up at the tail of a run.
 */
export const REMOTE_ATTACHMENT_FETCH_TIMEOUT_MS = 600_000
export const FITNESS_ARCHIVE_DIR = 'fitness_files/files'

export const getHandleFromActor = (actor: {
  username: string
  domain: string
}) => `${actor.username}@${actor.domain}`

export const getArchiveMediaPath = (storagePath: string) =>
  `${MEDIA_ARCHIVE_DIR}/${storagePath}`

export const getArchiveFitnessPath = (storagePath: string) =>
  `${FITNESS_ARCHIVE_DIR}/${storagePath}`

export type UrlToArchivePath = (url: string) => string

/**
 * What the caller needs to know about one call to `registerAttachmentUrl`.
 *
 * Only the budget case is reported, and only because a truncated run has to be
 * tellable apart from a run whose downloads genuinely failed: every other
 * terminal state already says everything it needs to in `warnings`. It is an
 * object rather than a bare boolean so both the return and the call site name
 * the bit rather than leaving its meaning in a comment.
 */
export interface AttachmentRegistrationResult {
  budgetExhausted?: boolean
}

/**
 * Shapes one status as the Create/Announce activity the ActivityPub outbox
 * would emit, mirroring app/api/users/[username]/outbox/route.ts, but for an
 * OWNER export rather than a federation response: every attachment is kept
 * (the federation serializer truncates to MAX_FEDERATION_MEDIA_ATTACHMENTS and
 * drops fitness attachments), attachment URLs are rewritten to their
 * archive-relative path, and embedded reply objects are stripped (they belong
 * to other actors and only bloat the file).
 */
export const buildExportActivity = ({
  status,
  urlToArchivePath
}: {
  status: Status
  urlToArchivePath: UrlToArchivePath
}): Record<string, unknown> => {
  if (status.type === StatusType.enum.Announce) {
    return {
      id: status.id,
      type: AnnounceAction,
      actor: status.actorId,
      published: getISOTimeUTC(status.createdAt),
      to: status.to,
      cc: status.cc,
      object: status.originalStatus.id
    }
  }

  const object = toActivityPubObject(status) as unknown as Record<
    string,
    unknown
  >

  object.attachment = status.attachments.map((attachment) => ({
    ...getDocumentFromAttachment(attachment),
    url: urlToArchivePath(attachment.url)
  }))

  if (
    object.replies &&
    typeof object.replies === 'object' &&
    'items' in (object.replies as Record<string, unknown>)
  ) {
    const replies = { ...(object.replies as Record<string, unknown>) }
    delete replies.items
    object.replies = replies
  }

  return {
    id: `${status.id}/activity`,
    type: CreateAction,
    actor: status.actorId,
    published: getISOTimeUTC(status.createdAt),
    to: status.to,
    cc: status.cc,
    object
  }
}

export const buildActorJson = ({
  person,
  avatarFileName,
  headerFileName
}: {
  person: Record<string, unknown>
  avatarFileName: string | null
  headerFileName: string | null
}): Record<string, unknown> => {
  const actorJson = { ...person }

  if (avatarFileName && actorJson.icon && typeof actorJson.icon === 'object') {
    actorJson.icon = {
      ...(actorJson.icon as Record<string, unknown>),
      url: avatarFileName
    }
  }

  if (
    headerFileName &&
    actorJson.image &&
    typeof actorJson.image === 'object'
  ) {
    actorJson.image = {
      ...(actorJson.image as Record<string, unknown>),
      url: headerFileName
    }
  }

  return actorJson
}

export const buildStatusHistoryEntry = (
  revision: StatusEditRevision,
  urlToArchivePath: UrlToArchivePath
) => ({
  text: revision.text,
  summary: revision.summary,
  sensitive: revision.sensitive,
  attachments: revision.attachments
    ? revision.attachments.map((attachment) => ({
        ...getDocumentFromAttachment(attachment),
        url: urlToArchivePath(attachment.url)
      }))
    : null,
  pollOptions: revision.pollOptions,
  supersededAt: getISOTimeUTC(revision.supersededAt)
})

export const buildFitnessArchiveEntry = (file: FitnessFile) => ({
  id: file.id,
  statusId: file.statusId ?? null,
  fileName: file.fileName,
  fileType: file.fileType,
  mimeType: file.mimeType,
  bytes: file.bytes,
  description: file.description ?? null,
  activityType: file.activityType ?? null,
  activityStartTime: file.activityStartTime
    ? getISOTimeUTC(file.activityStartTime)
    : null,
  totalDistanceMeters: file.totalDistanceMeters ?? null,
  totalDurationSeconds: file.totalDurationSeconds ?? null,
  movingTimeSeconds: file.movingTimeSeconds ?? null,
  elevationGainMeters: file.elevationGainMeters ?? null,
  deviceManufacturer: file.deviceManufacturer ?? null,
  deviceName: file.deviceName ?? null,
  sourceUrl: file.sourceUrl ?? null,
  importBatchId: file.importBatchId ?? null,
  archivePath: getArchiveFitnessPath(file.path),
  mapImageArchivePath: file.mapImagePath
    ? getArchiveMediaPath(file.mapImagePath)
    : null
})

export const csvEscape = (value: string) => {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

export interface FollowingCsvRow {
  handle: string
  showBoosts: boolean
  notify: boolean
  languages: string[] | null
}

export const buildFollowingCsv = (rows: FollowingCsvRow[]) => {
  const header = 'Account address,Show boosts,Notify on new posts,Languages'
  const lines = rows.map((row) =>
    [
      csvEscape(row.handle),
      row.showBoosts ? 'true' : 'false',
      row.notify ? 'true' : 'false',
      csvEscape((row.languages ?? []).join(', '))
    ].join(',')
  )
  return `${[header, ...lines].join('\n')}\n`
}

export const buildFollowersCsv = (handles: string[]) => {
  const header = 'Account address'
  const lines = handles.map((handle) => csvEscape(handle))
  return `${[header, ...lines].join('\n')}\n`
}

/**
 * The text before the first item of an OrderedCollection document. The three
 * pieces (head, comma-joined items, tail) are what both the file writer below
 * and the resumable account export emit, so the two cannot drift apart.
 *
 * NOTE_ACTIVITY_CONTEXT, not the bare AS2 url: the outbox collection embeds
 * notes from `toActivityPubObject`, which emits the FEP-044f quote aliases and
 * `interactionPolicy`, an attachment's blurhash/focalPoint, the Hashtag/Emoji
 * tag types and a poll's votersCount — and anything that compacts this file,
 * including our own `compactActivityPub`, drops every term the document's
 * context never defined. It supersets QUOTE_ACTIVITY_CONTEXT. The
 * likes/bookmarks collections written by the same helper carry bare ids, so
 * the extra term definitions are inert there.
 */
export const orderedCollectionHead = (id: string) =>
  `{"@context":${JSON.stringify(
    NOTE_ACTIVITY_CONTEXT
  )},"id":${JSON.stringify(id)},"type":"OrderedCollection","orderedItems":[`

export const orderedCollectionTail = (count: number) =>
  `],"totalItems":${count}}\n`

/**
 * Streams an OrderedCollection to disk one item at a time so a large account
 * never holds the whole outbox in memory.
 */
export const createOrderedCollectionWriter = (filePath: string, id: string) => {
  const stream = createWriteStream(filePath)
  let wroteFirst = false
  let count = 0

  stream.write(orderedCollectionHead(id))

  return {
    addItem: (item: unknown) => {
      if (wroteFirst) stream.write(',')
      stream.write(JSON.stringify(item))
      wroteFirst = true
      count += 1
    },
    close: async () => {
      stream.write(orderedCollectionTail(count))
      await new Promise<void>((resolve, reject) => {
        stream.once('error', reject)
        stream.end(() => resolve())
      })
      return count
    }
  }
}

export async function* forEachActorStatus(
  database: Database,
  actorId: string,
  pageSize: number
): AsyncGenerator<Status> {
  let maxStatusId: string | undefined

  for (;;) {
    // Every visibility is included: publicOnly/visibleToActorId/
    // includeFollowersOnly are deliberately omitted so this is a complete
    // export of the actor's own statuses, not a visitor's view of them.
    // visibility-unfiltered: an archive is for its own owner, so the
    // unfiltered query is the point. Declared for
    // lib/database/statusVisibilityCallSites.test.ts, which otherwise treats a
    // call with no audience as one that forgot to state one.
    const batch = await database.getActorStatuses({
      actorId,
      limit: pageSize,
      ...(maxStatusId ? { maxStatusId } : null)
    })
    if (batch.length === 0) return

    for (const status of batch) yield status

    if (batch.length < pageSize) return
    maxStatusId = batch[batch.length - 1].id
  }
}

export async function* forEachLike(
  database: Database,
  actorId: string,
  pageSize: number
): AsyncGenerator<Like> {
  let maxId: string | undefined

  for (;;) {
    const batch = await database.getLikes({
      actorId,
      limit: pageSize,
      ...(maxId ? { maxId } : null)
    })
    if (batch.length === 0) return

    for (const like of batch) yield like

    if (batch.length < pageSize) return
    const last = batch[batch.length - 1]
    maxId = encodeFavouriteCursor({
      createdAt: last.createdAt,
      statusId: last.statusId
    })
  }
}

export async function* forEachBookmark(
  database: Database,
  actorId: string,
  pageSize: number
): AsyncGenerator<Bookmark> {
  let maxId: string | undefined

  for (;;) {
    const batch = await database.getBookmarks({
      actorId,
      limit: pageSize,
      ...(maxId ? { maxId } : null)
    })
    if (batch.length === 0) return

    for (const bookmark of batch) yield bookmark

    if (batch.length < pageSize) return
    maxId = batch[batch.length - 1].id
  }
}

export async function* forEachFollowing(
  database: Database,
  actorId: string,
  pageSize: number
): AsyncGenerator<Follow> {
  let maxId: string | undefined

  for (;;) {
    const batch = await database.getFollowing({
      actorId,
      limit: pageSize,
      ...(maxId ? { maxId } : null)
    })
    if (batch.length === 0) return

    for (const follow of batch) yield follow

    if (batch.length < pageSize) return
    maxId = batch[batch.length - 1].id
  }
}

export async function* forEachFollower(
  database: Database,
  targetActorId: string,
  pageSize: number
): AsyncGenerator<Follow> {
  let maxId: string | undefined

  for (;;) {
    const batch = await database.getFollowers({
      targetActorId,
      limit: pageSize,
      ...(maxId ? { maxId } : null)
    })
    if (batch.length === 0) return

    for (const follow of batch) yield follow

    if (batch.length < pageSize) return
    maxId = batch[batch.length - 1].id
  }
}

export async function* forEachFitnessFile(
  database: Database,
  actorId: string,
  pageSize: number
): AsyncGenerator<FitnessFile> {
  let offset = 0

  for (;;) {
    const batch = await database.getFitnessFilesByActor({
      actorId,
      limit: pageSize,
      offset
    })
    if (batch.length === 0) return

    for (const file of batch) yield file

    if (batch.length < pageSize) return
    offset += batch.length
  }
}

// Resolves the target/source handle for each follow page in one batched
// getActorsFromIds call instead of one lookup per row.
export const collectFollowingRows = async (
  database: Database,
  actorId: string,
  pageSize: number
): Promise<FollowingCsvRow[]> => {
  const rows: FollowingCsvRow[] = []
  let maxId: string | undefined

  for (;;) {
    const batch = await database.getFollowing({
      actorId,
      limit: pageSize,
      ...(maxId ? { maxId } : null)
    })
    if (batch.length === 0) break

    const targets = await database.getActorsFromIds({
      ids: batch.map((follow) => follow.targetActorId)
    })
    const targetsById = new Map(targets.map((actor) => [actor.id, actor]))

    for (const follow of batch) {
      const target = targetsById.get(follow.targetActorId)
      rows.push({
        handle: target
          ? getHandleFromActor(target)
          : `unknown@${follow.targetActorHost}`,
        showBoosts: follow.reblogs,
        notify: follow.notify,
        languages: follow.languages
      })
    }

    if (batch.length < pageSize) break
    maxId = batch[batch.length - 1].id
  }

  return rows
}

export const collectFollowerHandles = async (
  database: Database,
  targetActorId: string,
  pageSize: number
): Promise<string[]> => {
  const handles: string[] = []
  let maxId: string | undefined

  for (;;) {
    const batch = await database.getFollowers({
      targetActorId,
      limit: pageSize,
      ...(maxId ? { maxId } : null)
    })
    if (batch.length === 0) break

    const sources = await database.getActorsFromIds({
      ids: batch.map((follow) => follow.actorId)
    })
    const sourcesById = new Map(sources.map((actor) => [actor.id, actor]))

    for (const follow of batch) {
      const source = sourcesById.get(follow.actorId)
      handles.push(
        source ? getHandleFromActor(source) : `unknown@${follow.actorHost}`
      )
    }

    if (batch.length < pageSize) break
    maxId = batch[batch.length - 1].id
  }

  return handles
}

export const pathExists = async (target: string) => {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

export const relocateStorageDir = async (
  stagingDir: string,
  sourceRelativePath: string,
  destinationRelativePath: string
) => {
  const source = path.join(stagingDir, sourceRelativePath)
  if (!(await pathExists(source))) return

  const destination = path.join(stagingDir, destinationRelativePath)
  await fs.rm(destination, { force: true, recursive: true })
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.rename(source, destination)
}

/**
 * Copies one profile image out of the archive's media directory to the
 * archive root, where the Mastodon format expects `avatar.<ext>` /
 * `header.<ext>`.
 */
export const copyProfileImage = async ({
  stagingDir,
  storagePath,
  fileNamePrefix,
  warnings
}: {
  stagingDir: string
  storagePath: string | null
  fileNamePrefix: 'avatar' | 'header'
  warnings: string[]
}): Promise<string | null> => {
  if (!storagePath) return null

  const extension = path.extname(storagePath) || '.bin'
  const fileName = `${fileNamePrefix}${extension}`
  const mediaDir = path.resolve(stagingDir, MEDIA_ARCHIVE_DIR)

  // `getMediaPathFromFileUrl` already refuses a `..` segment, so nothing
  // should arrive here that escapes. This is the step that turns a stored path
  // into a file read off the operator's machine, though, and its signature
  // says nothing about where the path came from — so it confirms containment
  // for itself rather than trusting a caller three hundred lines away, the
  // same reason `createMediaTempFilePath` asserts its own result is still
  // under `tmpdir()`.
  //
  // Through the shared helper: "does this resolve inside that root?" is the
  // storage drivers' question too, and docs/maintenance.md ("A stored path is confined
  // to the storage root") records why this call site stopped spelling its own
  // answer. The warning stays local so the archive keeps telling its operator
  // which image it dropped and why.
  const source = resolveStorageFilePath(mediaDir, storagePath)
  if (!source) {
    warnings.push(
      `Refused ${fileNamePrefix} image path outside the archive media directory: ${storagePath}`
    )
    return null
  }

  try {
    await fs.copyFile(
      source,
      path.join(/*turbopackIgnore: true*/ stagingDir, fileName)
    )
    return fileName
  } catch {
    warnings.push(
      `Could not copy ${fileNamePrefix} image from storage: ${storagePath}`
    )
    return null
  }
}

/**
 * Files one attachment URL: as a path this instance stores, or — only when
 * `--fetch-remote-attachments` was passed — as a copy downloaded into the
 * archive. `hostConfig` is what separates the two, and it has to: an
 * attachment federated from another activities.next instance carries the same
 * `/api/v1/files/` path this one serves, so without the host check its URL
 * became a local storage path that never resolved, and the download branch
 * below was never reached.
 *
 * The download runs through `safeImageFetch`, NOT the archive's own
 * `fetchPublicStorageResponse`. `attachment.url` is attacker-controlled by the
 * account owner — `POST /api/v1/accounts/outbox` takes `PostBoxAttachment.url`
 * as a bare `z.string()` and `createAttachment` writes it verbatim — so a
 * plain `fetch` here let an owner point the exporting machine at a
 * link-local or internal address and receive the response body back inside
 * their own tarball. `fetchPublicStorageResponse` keeps its plain `fetch`
 * because its other caller builds URLs from the operator's own configured
 * storage endpoint, which may legitimately be private-network or plain-http;
 * the guard belongs on the untrusted input, not on the shared helper.
 *
 * `safeImageFetch` re-checks every redirect hop, and its timeout also bounds
 * the body read, which the old header-only timeout did not — see
 * `REMOTE_ATTACHMENT_FETCH_TIMEOUT_MS` for why that means a much larger value
 * than the archive used before. The byte cap is separate and load-bearing:
 * without it a hostile URL could stream an unbounded body into memory.
 *
 * `remoteFetch` carries the byte cap and doubles as the on/off switch, so the
 * two cannot disagree. They were separate — a boolean plus a number the caller
 * set to 0 when unused — and 0 is a live cap meaning "refuse everything", kept
 * harmless only by an early return two screens above the read. As one value
 * that state is unrepresentable.
 *
 * The cap is a parameter rather than a constant because what matters is the
 * RESOLVED `media.maxFileSize` server setting, which an admin may raise to 1
 * GiB — reading the compile-time `MAX_FILE_SIZE` default instead would refuse a
 * remote attachment this instance's own upload path would accept.
 * `readResponseArrayBufferWithLimit` buffers, so the cap is also the peak
 * memory one attachment can cost.
 *
 * `deadline` is the export-wide budget, and it gates only whether a download
 * may START. Once it has passed, the attachment takes the same
 * warn-and-keep-the-absolute-URL path this function already takes for a
 * refused, over-size or failed one — which is exactly the behaviour of not
 * passing `--fetch-remote-attachments` at all, applied to the tail of the run.
 * Nothing in flight is ever aborted, so the budget cannot cost the archive a
 * download it had already begun; the price is that the last attachment to
 * start may still run for `REMOTE_ATTACHMENT_FETCH_TIMEOUT_MS` past the
 * deadline. The argument this replaced — that an aggregate bound must trade a
 * stall for silent data loss, which is worse in a backup — was a false
 * dichotomy: a bound that only declines to start new work loses nothing.
 */
export const registerAttachmentUrl = async ({
  attachment,
  hostConfig,
  mediaPaths,
  mediaIds,
  remoteFetch,
  urlToArchivePath,
  stagingDir,
  warnings
}: {
  attachment: Attachment
  hostConfig: HostRuleConfig
  mediaPaths: Set<string>
  mediaIds: Set<string>
  remoteFetch: { maxBytes: number; deadline: number } | null
  urlToArchivePath: Map<string, string>
  stagingDir: string
  warnings: string[]
}): Promise<AttachmentRegistrationResult> => {
  if (urlToArchivePath.has(attachment.url)) return {}

  const storagePath = getMediaPathFromFileUrl(attachment.url, hostConfig)
  if (storagePath) {
    mediaPaths.add(storagePath)
    urlToArchivePath.set(attachment.url, getArchiveMediaPath(storagePath))
    if (attachment.mediaId) mediaIds.add(attachment.mediaId)
    return {}
  }

  if (!remoteFetch) {
    warnings.push(`Remote attachment kept as absolute URL: ${attachment.url}`)
    return {}
  }

  // Below the local-storage branch on purpose: a path this instance already
  // holds costs no network at all, so an exhausted budget must not stop the
  // archive collecting it.
  if (Date.now() >= remoteFetch.deadline) {
    warnings.push(
      `Remote attachment fetch budget exhausted, kept as absolute URL: ${attachment.url}`
    )
    return { budgetExhausted: true }
  }

  try {
    const response = await safeImageFetch(attachment.url, {
      timeoutMs: REMOTE_ATTACHMENT_FETCH_TIMEOUT_MS,
      signal: AbortSignal.timeout(REMOTE_ATTACHMENT_FETCH_TIMEOUT_MS)
    })
    // `safeImageFetch` answers null for three different reasons — a refused
    // URL, a redirect carrying no usable `Location`, and exhausting its hop
    // budget — and the caller cannot tell them apart, so the warning must not
    // name only the first. Reporting a 4-hop CDN chain as an unsafe address
    // sends the operator hunting a DNS problem that does not exist.
    //
    // One string for all three is also a security property, so do not split
    // it: `getSafeImageDownloadUrl` resolves through `lookup(...).catch(=> [])`,
    // which makes a hostname that does not exist and one that resolves to a
    // private address refuse identically. A per-cause message would hand the
    // account owner — who chose this URL — an oracle for internal DNS.
    if (!response) {
      warnings.push(
        `Refused remote attachment URL (unsafe address, non-HTTPS, or too many redirects): ${attachment.url}`
      )
      return {}
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`HTTP ${response.status}`)
    }

    const buffer = Buffer.from(
      await readResponseArrayBufferWithLimit(
        response,
        remoteFetch.maxBytes,
        'Remote attachment'
      )
    )
    const hash = crypto
      .createHash('sha256')
      .update(attachment.url)
      .digest('hex')
      .slice(0, 16)
    const extension = path.extname(new URL(attachment.url).pathname)
    const relativePath = `${REMOTE_MEDIA_ARCHIVE_DIR}/${hash}${extension}`
    const absolutePath = path.join(stagingDir, relativePath)

    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, buffer)
    urlToArchivePath.set(attachment.url, relativePath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnings.push(
      `Failed to fetch remote attachment ${attachment.url}: ${message}`
    )
  }

  return {}
}

/**
 * The one line in `manifest.json` that says the run ran out of time rather
 * than that its downloads failed — the first is answered by re-running with a
 * larger budget, the second is not, and an operator reading a wall of
 * per-attachment warnings cannot tell them apart otherwise.
 *
 * Separated from the export so the operator-facing wording and the "only when
 * something was actually skipped" rule are testable without standing up a
 * database, storage and a tar writer, the way this file's other small builders
 * are.
 */
export const buildRemoteFetchBudgetWarning = ({
  skipped,
  budgetSeconds
}: {
  skipped: number
  budgetSeconds: number
}): string | null => {
  if (skipped <= 0) return null
  return (
    `Remote attachment fetch budget of ${budgetSeconds}s was exhausted; ` +
    `${skipped} remote attachment${skipped === 1 ? '' : 's'} kept as absolute URLs. ` +
    'Re-run with a larger --remote-fetch-budget to fetch them.'
  )
}
