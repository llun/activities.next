/**
 * Exports everything belonging to one local actor into a Mastodon-compatible
 * ActivityPub archive (tar.gz): every status regardless of visibility, media
 * attachment bytes, fitness activity files (an extension beyond the Mastodon
 * format), the actor profile, likes/bookmarks, and follow lists.
 *
 * Read-only against the database and storage. Reuses the staging/tar/storage
 * machinery from ./productionArchive rather than duplicating it.
 */
import crypto from 'crypto'
import { createWriteStream } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { NOTE_ACTIVITY_CONTEXT } from '@/lib/activities/noteContext'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { encodeFavouriteCursor } from '@/lib/database/sql/utils/favouriteCursor'
import { Database } from '@/lib/database/types'
import { getEffectiveFitnessStorageConfig } from '@/lib/services/fitness-files'
import { getMediaPathFromFileUrl } from '@/lib/services/medias/mediaFileUrl'
import { getMaxMediaUploadSize } from '@/lib/services/medias/uploadSizeLimit'
import {
  AnnounceAction,
  CreateAction
} from '@/lib/types/activitypub/activities'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import {
  GetMediaByIdsForAccountParams,
  Like,
  StatusEditRevision
} from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import {
  Attachment,
  getDocumentFromAttachment
} from '@/lib/types/domain/attachment'
import { Bookmark } from '@/lib/types/domain/bookmark'
import { Follow } from '@/lib/types/domain/follow'
import {
  Status,
  StatusType,
  getOriginalStatus,
  hasStatusBeenEdited,
  toActivityPubObject
} from '@/lib/types/domain/status'
import { getLocalActorOutboxId } from '@/lib/utils/activitypubId'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'
import { HostRuleConfig } from '@/lib/utils/host'
import { safeImageFetch } from '@/lib/utils/safeImageDownload'
import { readResponseArrayBufferWithLimit } from '@/lib/utils/streamLimit'

import { printDatabaseBanner } from '../fitness/describeConnection'
import {
  archiveStorage,
  buildStoragePlan,
  createTarArchive,
  getBooleanArg,
  getStringArg,
  loadEnvFile,
  parseKeyValueArgs
} from './productionArchive'

const ARCHIVE_VERSION = 1
const DEFAULT_ENV_FILE = '.env.production'
const DEFAULT_OUTPUT_DIR = 'backups/actor-archives'
const DEFAULT_PAGE_SIZE = 100
const MEDIA_ID_BATCH_SIZE = 100
const MEDIA_ARCHIVE_DIR = 'media_attachments/files'
const REMOTE_MEDIA_ARCHIVE_DIR = 'media_attachments/remote'
/**
 * How long ONE hop of a remote attachment download may take, headers and body
 * together — `safeImageFetch` keeps its `AbortSignal.timeout` live for the
 * whole read, where the archive's old 60s timer was cleared the moment headers
 * arrived and left the body untimed.
 *
 * Deliberately much larger than `PUBLIC_STORAGE_FETCH_TIMEOUT_MS`, because a
 * timeout that bounds the body is also a throughput floor: at 60s, reaching
 * even the default 200 MiB cap would have required a sustained 3.5 MB/s, so a
 * large federated video on an ordinary link would have been dropped from the
 * archive that used to contain it. Ten minutes puts that floor near 350 KB/s
 * at the default cap. It still bounds a slow-drip host, which unbounded did
 * not.
 */
export const REMOTE_ATTACHMENT_FETCH_TIMEOUT_MS = 600_000
const FITNESS_ARCHIVE_DIR = 'fitness_files/files'

export const EXPORT_ACTOR_USAGE = `Usage: NODE_ENV=production scripts/backup/exportActorArchive.ts \\
  (--username <name> [--domain <domain>] | --actor-id <https://host/users/name> | --email <email>) \\
  [--env-file .env.production] \\
  [--output-dir backups/actor-archives] \\
  [--page-size 100] \\
  [--allow-missing-storage] \\
  [--skip-storage] \\
  [--fetch-remote-attachments]`

export interface ExportActorArchiveArgs {
  username?: string
  domain?: string
  actorId?: string
  email?: string
  envFile: string
  outputDir: string
  pageSize: number
  allowMissingStorage: boolean
  skipStorage: boolean
  fetchRemoteAttachments: boolean
}

export const parseExportActorArgs = (
  args: string[]
): ExportActorArchiveArgs => {
  const parsed = parseKeyValueArgs(args)

  const username = getStringArg(parsed, 'username')
  const actorId = getStringArg(parsed, 'actor-id')
  const email = getStringArg(parsed, 'email')
  const selectorCount = [username, actorId, email].filter(Boolean).length
  if (selectorCount !== 1) {
    throw new Error(
      'Pass exactly one of --username, --actor-id, or --email to select the actor.'
    )
  }

  const pageSizeArg = getStringArg(
    parsed,
    'page-size',
    String(DEFAULT_PAGE_SIZE)
  )!
  const pageSize = Number(pageSizeArg)
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error(`Invalid value for --page-size: ${pageSizeArg}`)
  }

  return {
    username,
    domain: getStringArg(parsed, 'domain'),
    actorId,
    email,
    envFile: getStringArg(parsed, 'env-file', DEFAULT_ENV_FILE)!,
    outputDir: getStringArg(parsed, 'output-dir', DEFAULT_OUTPUT_DIR)!,
    pageSize,
    allowMissingStorage: getBooleanArg(parsed, 'allow-missing-storage'),
    skipStorage: getBooleanArg(parsed, 'skip-storage'),
    fetchRemoteAttachments: getBooleanArg(parsed, 'fetch-remote-attachments')
  }
}

export const resolveActor = async (
  database: Database,
  args: ExportActorArchiveArgs,
  defaultDomain: string
): Promise<Actor> => {
  const actor = args.actorId
    ? await database.getActorFromId({ id: args.actorId })
    : args.email
      ? await database.getActorFromEmail({ email: args.email })
      : await database.getActorFromUsername({
          username: args.username!,
          domain: args.domain ?? defaultDomain
        })

  if (!actor) {
    throw new Error('Actor not found.')
  }
  if (!actor.account) {
    throw new Error('Actor is not a local actor (no linked account).')
  }
  return actor
}

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

const buildStatusHistoryEntry = (
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

const buildFitnessArchiveEntry = (file: FitnessFile) => ({
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
 * Streams an OrderedCollection to disk one item at a time so a large account
 * never holds the whole outbox in memory.
 */
export const createOrderedCollectionWriter = (filePath: string, id: string) => {
  const stream = createWriteStream(filePath)
  let wroteFirst = false
  let count = 0

  // NOTE_ACTIVITY_CONTEXT, not the bare AS2 url: the outbox collection embeds
  // notes from `toActivityPubObject`, which emits the FEP-044f quote aliases and
  // `interactionPolicy`, an attachment's blurhash/focalPoint, the Hashtag/Emoji
  // tag types and a poll's votersCount — and anything that compacts this file,
  // including our own `compactActivityPub`, drops every term the document's
  // context never defined. It supersets QUOTE_ACTIVITY_CONTEXT. The
  // likes/bookmarks collections written by the same helper carry bare ids, so
  // the extra term definitions are inert there.
  stream.write(
    `{"@context":${JSON.stringify(
      NOTE_ACTIVITY_CONTEXT
    )},"id":${JSON.stringify(id)},"type":"OrderedCollection","orderedItems":[`
  )

  return {
    addItem: (item: unknown) => {
      if (wroteFirst) stream.write(',')
      stream.write(JSON.stringify(item))
      wroteFirst = true
      count += 1
    },
    close: async () => {
      stream.write(`],"totalItems":${count}}\n`)
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
const collectFollowingRows = async (
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

const collectFollowerHandles = async (
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

const pathExists = async (target: string) => {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

const relocateStorageDir = async (
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
  const source = path.resolve(mediaDir, storagePath)

  // `getMediaPathFromFileUrl` already refuses a `..` segment, so nothing
  // should arrive here that escapes. This is the step that turns a stored path
  // into a file read off the operator's machine, though, and its signature
  // says nothing about where the path came from — so it confirms containment
  // for itself rather than trusting a caller three hundred lines away, the
  // same reason `createMediaTempFilePath` asserts its own result is still
  // under `tmpdir()`. Resolving rather than joining is what lets an absolute
  // path be seen as outside instead of being silently reinterpreted as a
  // relative one.
  //
  // The last disjunct is Windows-only and cannot be covered by a test here:
  // between two absolute paths POSIX always answers with a relative string,
  // and only a win32 CROSS-DRIVE pair (`C:\staging` to `D:\secrets`) makes
  // `path.relative` hand back an absolute path of its own.
  const relativePath = path.relative(mediaDir, source)
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    warnings.push(
      `Refused ${fileNamePrefix} image path outside the archive media directory: ${storagePath}`
    )
    return null
  }

  try {
    await fs.copyFile(source, path.join(stagingDir, fileName))
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
 * `maxAttachmentBytes` is a parameter rather than a constant because the cap
 * that matters is the RESOLVED `media.maxFileSize` server setting, which an
 * admin may raise to 1 GiB — reading the compile-time `MAX_FILE_SIZE` default
 * instead would refuse a remote attachment this instance's own upload path
 * would accept. `readResponseArrayBufferWithLimit` buffers, so whatever is
 * passed is also the peak memory one attachment can cost.
 */
export const registerAttachmentUrl = async ({
  attachment,
  fetchRemoteAttachments,
  hostConfig,
  maxAttachmentBytes,
  mediaPaths,
  mediaIds,
  urlToArchivePath,
  stagingDir,
  warnings
}: {
  attachment: Attachment
  fetchRemoteAttachments: boolean
  hostConfig: HostRuleConfig
  maxAttachmentBytes: number
  mediaPaths: Set<string>
  mediaIds: Set<string>
  urlToArchivePath: Map<string, string>
  stagingDir: string
  warnings: string[]
}) => {
  if (urlToArchivePath.has(attachment.url)) return

  const storagePath = getMediaPathFromFileUrl(attachment.url, hostConfig)
  if (storagePath) {
    mediaPaths.add(storagePath)
    urlToArchivePath.set(attachment.url, getArchiveMediaPath(storagePath))
    if (attachment.mediaId) mediaIds.add(attachment.mediaId)
    return
  }

  if (!fetchRemoteAttachments) {
    warnings.push(`Remote attachment kept as absolute URL: ${attachment.url}`)
    return
  }

  try {
    const response = await safeImageFetch(attachment.url, {
      timeoutMs: REMOTE_ATTACHMENT_FETCH_TIMEOUT_MS
    })
    // `safeImageFetch` answers null for three different reasons — a refused
    // URL, a redirect carrying no usable `Location`, and exhausting its hop
    // budget — and the caller cannot tell them apart, so the warning must not
    // name only the first. Reporting a 4-hop CDN chain as an unsafe address
    // sends the operator hunting a DNS problem that does not exist.
    if (!response) {
      warnings.push(
        `Refused remote attachment URL (unsafe address, non-HTTPS, or too many redirects): ${attachment.url}`
      )
      return
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`HTTP ${response.status}`)
    }

    const buffer = Buffer.from(
      await readResponseArrayBufferWithLimit(
        response,
        maxAttachmentBytes,
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
}

const createArchiveTimestamp = () =>
  new Date().toISOString().replaceAll(':', '').replaceAll('.', '')

export const exportActorArchive = async (
  cliArgs: string[] = process.argv.slice(2)
): Promise<number> => {
  if (cliArgs.includes('--help') || cliArgs.includes('-h')) {
    console.log(EXPORT_ACTOR_USAGE)
    return 0
  }

  const args = parseExportActorArgs(cliArgs)
  await loadEnvFile(args.envFile)
  printDatabaseBanner()

  const config = getConfig()
  const database = getDatabase()
  if (!database) {
    console.error('Database not available.')
    return 1
  }

  const actor = await resolveActor(database, args, config.host)
  const accountId = actor.account!.id
  const handle = getHandleFromActor(actor)

  const stagingDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'activitynext-actor-archive-')
  )

  // Resolved once for the whole export rather than per attachment: it is a
  // database read behind a 15s cache, and the cap must not shift mid-run.
  const maxAttachmentBytes = await getMaxMediaUploadSize(database)

  const warnings: string[] = []
  const mediaPaths = new Set<string>()
  const fitnessPaths = new Set<string>()
  const mediaIds = new Set<string>()
  const urlToArchivePath = new Map<string, string>()
  const resolveArchivePath: UrlToArchivePath = (url) =>
    urlToArchivePath.get(url) ?? url
  const statusHistory: Record<string, unknown[]> = {}

  try {
    const outboxWriter = createOrderedCollectionWriter(
      path.join(stagingDir, 'outbox.json'),
      getLocalActorOutboxId(actor.id)
    )

    let statusCount = 0
    for await (const status of forEachActorStatus(
      database,
      actor.id,
      args.pageSize
    )) {
      statusCount += 1

      if (status.type !== StatusType.enum.Announce) {
        for (const attachment of status.attachments) {
          await registerAttachmentUrl({
            attachment,
            fetchRemoteAttachments: args.fetchRemoteAttachments,
            hostConfig: config,
            maxAttachmentBytes,
            mediaPaths,
            mediaIds,
            urlToArchivePath,
            stagingDir,
            warnings
          })
        }

        if (hasStatusBeenEdited(status)) {
          const revisions = await database.getStatusEditHistory({
            statusId: status.id
          })
          statusHistory[status.id] = revisions.map((revision) =>
            buildStatusHistoryEntry(revision, resolveArchivePath)
          )
        }
      }

      outboxWriter.addItem(
        buildExportActivity({ status, urlToArchivePath: resolveArchivePath })
      )
    }
    await outboxWriter.close()

    // Thumbnails aren't referenced by any URL on the status, so they only
    // enter the archive by resolving each attachment's mediaId.
    if (!args.skipStorage && mediaIds.size > 0) {
      const idList = [...mediaIds]
      for (let index = 0; index < idList.length; index += MEDIA_ID_BATCH_SIZE) {
        const chunk = idList.slice(index, index + MEDIA_ID_BATCH_SIZE)
        const medias = await database.getMediaByIdsForAccount({
          mediaIds: chunk,
          accountId
        } satisfies GetMediaByIdsForAccountParams)
        for (const media of medias) {
          mediaPaths.add(media.original.path)
          if (media.thumbnail?.path) mediaPaths.add(media.thumbnail.path)
        }
      }
    }

    const fitnessEntries: unknown[] = []
    let fitnessCount = 0
    for await (const file of forEachFitnessFile(
      database,
      actor.id,
      args.pageSize
    )) {
      fitnessCount += 1
      fitnessPaths.add(file.path)
      if (file.mapImagePath) mediaPaths.add(file.mapImagePath)
      if (file.mapImageEmailPath) mediaPaths.add(file.mapImageEmailPath)
      fitnessEntries.push(buildFitnessArchiveEntry(file))
    }

    const iconPath = actor.iconUrl
      ? getMediaPathFromFileUrl(actor.iconUrl, config)
      : null
    const headerPath = actor.headerImageUrl
      ? getMediaPathFromFileUrl(actor.headerImageUrl, config)
      : null
    if (iconPath) mediaPaths.add(iconPath)
    if (headerPath) mediaPaths.add(headerPath)

    const likesWriter = createOrderedCollectionWriter(
      path.join(stagingDir, 'likes.json'),
      `${actor.id}/likes-archive`
    )
    let likeCount = 0
    for await (const like of forEachLike(database, actor.id, args.pageSize)) {
      likeCount += 1
      likesWriter.addItem(like.statusId)
    }
    await likesWriter.close()

    const bookmarksWriter = createOrderedCollectionWriter(
      path.join(stagingDir, 'bookmarks.json'),
      `${actor.id}/bookmarks-archive`
    )
    let bookmarkCount = 0
    for await (const bookmark of forEachBookmark(
      database,
      actor.id,
      args.pageSize
    )) {
      bookmarkCount += 1
      bookmarksWriter.addItem(bookmark.statusId)
    }
    await bookmarksWriter.close()

    const followingRows = await collectFollowingRows(
      database,
      actor.id,
      args.pageSize
    )
    const followerHandles = await collectFollowerHandles(
      database,
      actor.id,
      args.pageSize
    )

    const effectiveFitnessStorage = getEffectiveFitnessStorageConfig()
    if (!args.skipStorage) {
      if (mediaPaths.size > 0 && !config.mediaStorage) {
        warnings.push(
          'Media storage is not configured; referenced media files were not archived.'
        )
      }
      if (fitnessPaths.size > 0 && !effectiveFitnessStorage) {
        warnings.push(
          'Fitness storage is not configured; referenced fitness files were not archived.'
        )
      }
    }

    const storageManifest = args.skipStorage
      ? []
      : await archiveStorage(
          buildStoragePlan({
            fitnessFilePaths: [...fitnessPaths],
            fitnessStorage: effectiveFitnessStorage,
            mediaFilePaths: [...mediaPaths],
            mediaStorage: config.mediaStorage,
            scope: 'referenced'
          }),
          stagingDir,
          { allowMissingStorage: args.allowMissingStorage }
        )

    await relocateStorageDir(
      stagingDir,
      'storage/media/files',
      MEDIA_ARCHIVE_DIR
    )
    await relocateStorageDir(
      stagingDir,
      'storage/fitness/files',
      FITNESS_ARCHIVE_DIR
    )
    await fs.rm(path.join(stagingDir, 'storage'), {
      force: true,
      recursive: true
    })

    const person = getPersonFromActor(actor)
    const avatarFileName = await copyProfileImage({
      stagingDir,
      storagePath: iconPath,
      fileNamePrefix: 'avatar',
      warnings
    })
    const headerFileName = await copyProfileImage({
      stagingDir,
      storagePath: headerPath,
      fileNamePrefix: 'header',
      warnings
    })

    await fs.writeFile(
      path.join(stagingDir, 'actor.json'),
      `${JSON.stringify(
        buildActorJson({
          person: person as unknown as Record<string, unknown>,
          avatarFileName,
          headerFileName
        }),
        null,
        2
      )}\n`
    )

    await fs.writeFile(
      path.join(stagingDir, 'following_accounts.csv'),
      buildFollowingCsv(followingRows)
    )
    await fs.writeFile(
      path.join(stagingDir, 'followers.csv'),
      buildFollowersCsv(followerHandles)
    )

    await fs.mkdir(path.join(stagingDir, 'fitness_files'), {
      recursive: true
    })
    await fs.writeFile(
      path.join(stagingDir, 'fitness_files', 'fitness.json'),
      `${JSON.stringify(fitnessEntries, null, 2)}\n`
    )

    await fs.writeFile(
      path.join(stagingDir, 'status_history.json'),
      `${JSON.stringify(statusHistory, null, 2)}\n`
    )

    await fs.writeFile(
      path.join(stagingDir, 'manifest.json'),
      `${JSON.stringify(
        {
          kind: 'actor-archive',
          version: ARCHIVE_VERSION,
          createdAt: new Date().toISOString(),
          actor: { id: actor.id, handle, domain: actor.domain },
          counts: {
            statuses: statusCount,
            likes: likeCount,
            bookmarks: bookmarkCount,
            following: followingRows.length,
            followers: followerHandles.length,
            fitnessFiles: fitnessCount
          },
          storage: storageManifest,
          warnings
        },
        null,
        2
      )}\n`
    )

    const outputDir = path.resolve(process.cwd(), args.outputDir)
    const archivePath = path.join(
      outputDir,
      `actor-archive-${actor.username}-${createArchiveTimestamp()}.tar.gz`
    )
    await createTarArchive(stagingDir, archivePath)

    console.log(`Archive written: ${archivePath}`)
    console.log(
      `Statuses: ${statusCount}, Likes: ${likeCount}, Bookmarks: ${bookmarkCount}, ` +
        `Following: ${followingRows.length}, Followers: ${followerHandles.length}, ` +
        `Fitness files: ${fitnessCount}`
    )
    if (warnings.length > 0) {
      console.log(`Warnings (${warnings.length}):`)
      for (const warning of warnings) console.log(`  - ${warning}`)
    }

    return 0
  } finally {
    await database.destroy()
    await fs.rm(stagingDir, { force: true, recursive: true })
  }
}
