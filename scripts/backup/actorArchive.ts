/**
 * Operator CLI that exports everything belonging to one local actor into a
 * Mastodon-compatible ActivityPub archive (tar.gz): every status regardless of
 * visibility, media attachment bytes, fitness activity files (an extension
 * beyond the Mastodon format), the actor profile, likes/bookmarks, and follow
 * lists.
 *
 * Read-only against the database and storage. The Mastodon-shaped builders,
 * readers and writers live in lib/services/accountArchive/actorArchive.ts and
 * are shared with the user-facing account export; this file keeps only what is
 * specific to the command line (arguments, staging directory, tar.gz) and
 * re-exports the core so existing importers keep working. It reuses the
 * staging/tar/storage machinery from ./productionArchive.
 */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import {
  FITNESS_ARCHIVE_DIR,
  MEDIA_ARCHIVE_DIR,
  UrlToArchivePath,
  buildActorJson,
  buildExportActivity,
  buildFitnessArchiveEntry,
  buildFollowersCsv,
  buildFollowingCsv,
  buildRemoteFetchBudgetWarning,
  buildStatusHistoryEntry,
  collectFollowerHandles,
  collectFollowingRows,
  copyProfileImage,
  createOrderedCollectionWriter,
  forEachActorStatus,
  forEachBookmark,
  forEachFitnessFile,
  forEachLike,
  getHandleFromActor,
  registerAttachmentUrl,
  relocateStorageDir
} from '@/lib/services/accountArchive/actorArchive'
import {
  getServedHostConfig,
  refreshServedDomains
} from '@/lib/services/domains/servedDomainSnapshot'
import { getEffectiveFitnessStorageConfig } from '@/lib/services/fitness-files'
import { getMediaPathFromFileUrl } from '@/lib/services/medias/mediaFileUrl'
import { getMaxMediaUploadSize } from '@/lib/services/medias/uploadSizeLimit'
import { GetMediaByIdsForAccountParams } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { StatusType, hasStatusBeenEdited } from '@/lib/types/domain/status'
import { getLocalActorOutboxId } from '@/lib/utils/activitypubId'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'

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

export * from '@/lib/services/accountArchive/actorArchive'

const ARCHIVE_VERSION = 1
const DEFAULT_ENV_FILE = '.env.production'
const DEFAULT_OUTPUT_DIR = 'backups/actor-archives'
const DEFAULT_PAGE_SIZE = 100
const MEDIA_ID_BATCH_SIZE = 100
/**
 * How long the export as a whole may keep STARTING remote attachment
 * downloads, in seconds. Overridable with `--remote-fetch-budget`.
 *
 * `REMOTE_ATTACHMENT_FETCH_TIMEOUT_MS` bounds one attachment; nothing bounded
 * their sum, and an actor's history is not capped the way a single status is.
 * The URLs are owner-supplied, so an account facing a ban or a legal request —
 * exactly when `--fetch-remote-attachments` gets used — could plant enough
 * hosts dripping bytes just under the per-attachment ceiling to stall the run
 * for days.
 *
 * An hour is generous for the legitimate case rather than tuned to the hostile
 * one: a local actor's own attachments are normally in this instance's own
 * storage, so the remote branch is the exception, and an ordinary attachment
 * costs a second or two. What matters more than the number is that exhausting
 * it loses nothing — see `registerAttachmentUrl`.
 */
const DEFAULT_REMOTE_FETCH_BUDGET_SECONDS = 3600

export const EXPORT_ACTOR_USAGE = `Usage: NODE_ENV=production scripts/backup/exportActorArchive.ts \\
  (--username <name> [--domain <domain>] | --actor-id <https://host/users/name> | --email <email>) \\
  [--env-file .env.production] \\
  [--output-dir backups/actor-archives] \\
  [--page-size 100] \\
  [--allow-missing-storage] \\
  [--skip-storage] \\
  [--fetch-remote-attachments] \\
  [--remote-fetch-budget 3600]`

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
  /**
   * Seconds the export may go on STARTING remote attachment downloads. Inert
   * without `--fetch-remote-attachments`.
   */
  remoteFetchBudgetSeconds: number
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

  const budgetArg = getStringArg(
    parsed,
    'remote-fetch-budget',
    String(DEFAULT_REMOTE_FETCH_BUDGET_SECONDS)
  )!
  const remoteFetchBudgetSeconds = Number(budgetArg)
  // Rejecting zero rather than reading it as "no budget" is deliberate: zero
  // is a live value meaning "start nothing", and an operator who wants the old
  // unbounded behaviour can say so out loud with a large number.
  if (
    !Number.isInteger(remoteFetchBudgetSeconds) ||
    remoteFetchBudgetSeconds <= 0
  ) {
    throw new Error(
      `Invalid value for --remote-fetch-budget: ${budgetArg}. Expected a positive whole number of seconds.`
    )
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
    fetchRemoteAttachments: getBooleanArg(parsed, 'fetch-remote-attachments'),
    remoteFetchBudgetSeconds
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

  // Attachment and image URLs on an Admin › Domains row are ours too.
  await refreshServedDomains(database)
  const hostConfig = getServedHostConfig(config)

  const actor = await resolveActor(database, args, config.host)
  const accountId = actor.account!.id
  const handle = getHandleFromActor(actor)

  const stagingDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'activitynext-actor-archive-')
  )

  // Resolved once for the whole export rather than per attachment: it is a
  // database read behind a 15s cache, and the cap must not shift mid-run. Only
  // the remote-download branch reads it, so an export without that flag — the
  // default — should not pay for the lookup at all.
  //
  // The deadline is stamped here, immediately before the status walk that
  // issues every download, and it is wall-clock rather than a meter of time
  // spent inside fetches. Metering only the fetches would leave the run
  // unbounded again the moment the slowness came from anywhere else, and what
  // an operator needs bounded is when the export ends, not how its time was
  // spent. The cost of that choice is that database paging and edit-history
  // reads in the same loop also draw on the budget.
  const remoteFetch = args.fetchRemoteAttachments
    ? {
        maxBytes: await getMaxMediaUploadSize(database),
        deadline: Date.now() + args.remoteFetchBudgetSeconds * 1000
      }
    : null
  let remoteFetchBudgetSkipped = 0

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
          const { budgetExhausted } = await registerAttachmentUrl({
            attachment,
            hostConfig,
            mediaPaths,
            mediaIds,
            remoteFetch,
            urlToArchivePath,
            stagingDir,
            warnings
          })
          if (budgetExhausted) remoteFetchBudgetSkipped += 1
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

    const budgetWarning = buildRemoteFetchBudgetWarning({
      skipped: remoteFetchBudgetSkipped,
      budgetSeconds: args.remoteFetchBudgetSeconds
    })
    if (budgetWarning) warnings.push(budgetWarning)

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
        // A photo edit keeps the uploaded file and earlier renders beside the
        // live one (only the account's own media, as resolved above).
        const editFiles = await database.listMediaEditFiles({
          mediaIds: medias.map((media) => media.id)
        })
        for (const file of editFiles) mediaPaths.add(file.path)
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
      ? getMediaPathFromFileUrl(actor.iconUrl, hostConfig)
      : null
    const headerPath = actor.headerImageUrl
      ? getMediaPathFromFileUrl(actor.headerImageUrl, hostConfig)
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
