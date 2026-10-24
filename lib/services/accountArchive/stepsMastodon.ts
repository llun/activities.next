import path from 'path'

import type { AccountExportCursor } from '@/lib/database/domains/accountExport/types'
import { encodeFavouriteCursor } from '@/lib/database/domains/like/favouriteCursor'
import { getMediaPathFromFileUrl } from '@/lib/services/medias/mediaFileUrl'
import { StatusType, hasStatusBeenEdited } from '@/lib/types/domain/status'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'

import {
  MEDIA_ARCHIVE_DIR,
  buildActorJson,
  buildExportActivity,
  getArchiveMediaPath,
  orderedCollectionHead,
  orderedCollectionTail
} from './actorArchive'
import { entryPath } from './layout'
import { readAllExportRows } from './rows'
import { buildStatusRecord } from './statusRecord'
import type { CollectorStep, StepContext } from './steps.types'

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

const MEDIA_ID_BATCH_SIZE = 100

/**
 * The settings keys that make it into profile.json: the owner's own profile
 * and preference choices. An allowlist, so a key added to ActorSettings later
 * (bookkeeping, tokens, server state) stays out until someone opts it in.
 */
export const EXPORTED_ACTOR_SETTING_KEYS = [
  'iconUrl',
  'headerImageUrl',
  'manuallyApprovesFollowers',
  'fields',
  'tags',
  'bot',
  'discoverable',
  'indexable',
  'hideCollections',
  'attributionDomains',
  'movedTo',
  'alsoKnownAs',
  'defaultPrivacy',
  'defaultSensitive',
  'defaultLanguage',
  'defaultQuotePolicy',
  'postLineLimit',
  'readingExpandMedia',
  'readingExpandSpoilers',
  'readingAutoplayGifs',
  'emailNotifications',
  'pushNotifications',
  'notificationPolicy',
  'avatarDescription',
  'headerDescription',
  'showMedia',
  'showMediaReplies',
  'showFeatured'
] as const

export const exportedActorSettings = (
  settings: Record<string, unknown>
): Record<string, unknown> => {
  const kept: Record<string, unknown> = {}
  for (const key of EXPORTED_ACTOR_SETTING_KEYS) {
    if (settings[key] !== undefined) kept[key] = settings[key]
  }
  return kept
}

/** The archive-relative path (from the actor's Mastodon root) of a local file URL. */
const makeUrlToArchivePath = (context: StepContext) => (url: string) => {
  const storagePath = getMediaPathFromFileUrl(url, context.hostConfig)
  return storagePath ? getArchiveMediaPath(storagePath) : url
}

/** Files a media path under the actor's Mastodon root, where outbox.json points. */
const addMediaFile = (context: StepContext, storagePath: string) =>
  context.addFile(
    entryPath(context.actor.mastodonDir, MEDIA_ARCHIVE_DIR, storagePath),
    'media',
    storagePath
  )

const profileImageName = (
  storagePath: string | null,
  prefix: 'avatar' | 'header'
) => (storagePath ? `${prefix}${path.extname(storagePath) || '.bin'}` : null)

export const profileStep: CollectorStep = {
  name: 'profile',
  async run(context) {
    const { database, actor, accountId } = context
    const record = await database.getActorFromId({ id: actor.id })
    if (!record) {
      context.warn(`Actor ${actor.id} no longer exists; it was skipped.`)
      return 'done'
    }

    const iconPath = record.iconUrl
      ? getMediaPathFromFileUrl(record.iconUrl, context.hostConfig)
      : null
    const headerPath = record.headerImageUrl
      ? getMediaPathFromFileUrl(record.headerImageUrl, context.hostConfig)
      : null
    // A profile image URL is free text that only has to name a file on this
    // host, so the copy is limited to files that are the actor's own media.
    const owns = async (storagePath: string | null) => {
      if (!storagePath) return null
      if (
        await database.ownsAccountExportMediaPath({
          accountId,
          path: storagePath
        })
      ) {
        return storagePath
      }
      context.warn(
        "A profile image is not one of the account's own media and was not copied."
      )
      return null
    }
    const ownedIconPath = await owns(iconPath)
    const ownedHeaderPath = await owns(headerPath)
    const avatarName = profileImageName(ownedIconPath, 'avatar')
    const headerName = profileImageName(ownedHeaderPath, 'header')
    if (ownedIconPath && avatarName) {
      context.addFile(
        entryPath(actor.mastodonDir, avatarName),
        'media',
        ownedIconPath
      )
    }
    if (ownedHeaderPath && headerName) {
      context.addFile(
        entryPath(actor.mastodonDir, headerName),
        'media',
        ownedHeaderPath
      )
    }

    await context.stage.append(
      entryPath(actor.mastodonDir, 'actor.json'),
      json({
        ...buildActorJson({
          person: getPersonFromActor(record) as unknown as Record<
            string,
            unknown
          >,
          avatarFileName: avatarName,
          headerFileName: headerName
        }),
        // The collections sit next to actor.json in the archive, as in a
        // Mastodon backup, so they are named by relative path (this server's
        // own URLs mean nothing to the importer).
        outbox: 'outbox.json',
        likes: 'likes.json',
        bookmarks: 'bookmarks.json'
      })
    )

    const profile = (await database.getAccountExportActors({ accountId })).find(
      (candidate) => candidate.id === actor.id
    )
    await context.stage.append(
      entryPath(actor.dir, 'profile.json'),
      json({
        id: actor.id,
        publicId: profile?.publicId ?? null,
        handle: `${actor.username}@${actor.domain}`,
        username: actor.username,
        domain: actor.domain,
        name: profile?.name ?? null,
        summary: profile?.summary ?? null,
        type: profile?.type ?? null,
        isDefault: actor.isDefault,
        createdAt: profile ? new Date(profile.createdAt).toISOString() : null,
        settings: exportedActorSettings(profile?.settings ?? {})
      })
    )
    return 'done'
  }
}

interface OutboxCursor {
  started?: boolean
  maxStatusId?: string
}

export const outboxStep: CollectorStep = {
  name: 'outbox',
  async run(context, raw) {
    const { database, actor, stage } = context
    const cursor = (raw ?? {}) as OutboxCursor
    const outbox = entryPath(actor.mastodonDir, 'outbox.json')
    const statusesFile = entryPath(actor.dir, 'statuses.jsonl')

    if (!cursor.started) {
      await stage.append(outbox, orderedCollectionHead('outbox.json'))
      stage.touch(statusesFile)
    }

    // visibility-unfiltered: an export is for its own owner and holds every
    // visibility, as the operator export does. Declared for
    // lib/database/statusVisibilityCallSites.test.ts, which otherwise treats a
    // call with no audience as one that forgot to state one.
    const batch = await database.getActorStatuses({
      actorId: actor.id,
      limit: context.pageSize,
      ...(cursor.maxStatusId ? { maxStatusId: cursor.maxStatusId } : null)
    })

    const pinned = await context.memo('pins', async () => {
      const rows = await readAllExportRows(
        database,
        'status_pins',
        actor.id,
        context.pageSize
      )
      return new Set(rows.map((row) => String(row.statusId)))
    })
    const urlToArchivePath = makeUrlToArchivePath(context)

    const activities: unknown[] = []
    const records: unknown[] = []
    const mediaIds = new Set<string>()
    for (const status of batch) {
      let history = null
      if (status.type !== StatusType.enum.Announce) {
        for (const attachment of status.attachments) {
          const storagePath = getMediaPathFromFileUrl(
            attachment.url,
            context.hostConfig
          )
          if (storagePath) {
            addMediaFile(context, storagePath)
            if (attachment.mediaId) mediaIds.add(attachment.mediaId)
          }
        }
        if (hasStatusBeenEdited(status)) {
          history = await database.getStatusEditHistory({ statusId: status.id })
        }
      }
      activities.push(buildExportActivity({ status, urlToArchivePath }))
      records.push(
        buildStatusRecord({
          status,
          pinned: pinned.has(status.id),
          history,
          urlToArchivePath
        })
      )
    }

    // Thumbnails and earlier edit renders are not referenced by any URL on the
    // status, so they only enter the archive through each attachment's media id.
    const ids = [...mediaIds]
    for (let index = 0; index < ids.length; index += MEDIA_ID_BATCH_SIZE) {
      const chunk = ids.slice(index, index + MEDIA_ID_BATCH_SIZE)
      const medias = await database.getMediaByIdsForAccount({
        mediaIds: chunk,
        accountId: context.accountId
      })
      for (const media of medias) {
        addMediaFile(context, media.original.path)
        if (media.thumbnail?.path) addMediaFile(context, media.thumbnail.path)
      }
      const editFiles = await database.listMediaEditFiles({
        mediaIds: medias.map((media) => media.id)
      })
      for (const file of editFiles) addMediaFile(context, file.path)
    }

    await stage.appendJsonItems(outbox, activities)
    await stage.appendJsonLines(statusesFile, records)
    context.stats.statuses += batch.length

    if (batch.length < context.pageSize) {
      await stage.append(outbox, orderedCollectionTail(stage.count(outbox)))
      return 'done'
    }
    return {
      cursor: {
        started: true,
        maxStatusId: batch[batch.length - 1].id
      } satisfies OutboxCursor
    }
  }
}

interface LikesCursor {
  started?: boolean
  maxId?: string
}

export const likesStep: CollectorStep = {
  name: 'likes',
  async run(context, raw) {
    const { database, actor, stage } = context
    const cursor = (raw ?? {}) as LikesCursor
    const entry = entryPath(actor.mastodonDir, 'likes.json')
    if (!cursor.started) {
      await stage.append(entry, orderedCollectionHead('likes.json'))
    }

    const batch = await database.getLikes({
      actorId: actor.id,
      limit: context.pageSize,
      ...(cursor.maxId ? { maxId: cursor.maxId } : null)
    })
    await stage.appendJsonItems(
      entry,
      batch.map((like) => like.statusId)
    )
    context.stats.likes += batch.length

    if (batch.length < context.pageSize) {
      await stage.append(entry, orderedCollectionTail(stage.count(entry)))
      return 'done'
    }
    const last = batch[batch.length - 1]
    return {
      cursor: {
        started: true,
        maxId: encodeFavouriteCursor({
          createdAt: last.createdAt,
          statusId: last.statusId
        })
      } satisfies LikesCursor
    }
  }
}

/** The bookmarks cursor: a keyset on the row id, so a deleted row cannot end it. */
interface BookmarksCursor {
  started?: boolean
  after?: AccountExportCursor | null
}

export const bookmarksStep: CollectorStep = {
  name: 'bookmarks',
  async run(context, raw) {
    const { database, actor, stage } = context
    const cursor = (raw ?? {}) as BookmarksCursor
    const entry = entryPath(actor.mastodonDir, 'bookmarks.json')
    if (!cursor.started) {
      await stage.append(entry, orderedCollectionHead('bookmarks.json'))
    }

    const page = await database.getAccountExportRows({
      table: 'bookmarks',
      actorId: actor.id,
      after: cursor.after ?? null,
      limit: context.pageSize
    })
    await stage.appendJsonItems(
      entry,
      page.rows.map((row) => String(row.statusId))
    )
    context.stats.bookmarks += page.rows.length

    if (!page.next) {
      await stage.append(entry, orderedCollectionTail(stage.count(entry)))
      return 'done'
    }
    return {
      cursor: { started: true, after: page.next } satisfies BookmarksCursor
    }
  }
}
