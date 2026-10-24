import path from 'path'

import { encodeFavouriteCursor } from '@/lib/database/domains/like/favouriteCursor'
import { getMediaPathFromFileUrl } from '@/lib/services/medias/mediaFileUrl'
import { StatusType, hasStatusBeenEdited } from '@/lib/types/domain/status'
import { getLocalActorOutboxId } from '@/lib/utils/activitypubId'
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

/** Settings keys that are bookkeeping of this server, not the owner's profile. */
export const INTERNAL_ACTOR_SETTING_KEYS = ['linksCheckedAt', 'moveProcessing']

export const withoutInternalSettings = (
  settings: Record<string, unknown>
): Record<string, unknown> => {
  const kept = { ...settings }
  for (const key of INTERNAL_ACTOR_SETTING_KEYS) delete kept[key]
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
    const avatarName = profileImageName(iconPath, 'avatar')
    const headerName = profileImageName(headerPath, 'header')
    if (iconPath && avatarName) {
      context.addFile(
        entryPath(actor.mastodonDir, avatarName),
        'media',
        iconPath
      )
    }
    if (headerPath && headerName) {
      context.addFile(
        entryPath(actor.mastodonDir, headerName),
        'media',
        headerPath
      )
    }

    await context.stage.append(
      entryPath(actor.mastodonDir, 'actor.json'),
      json(
        buildActorJson({
          person: getPersonFromActor(record) as unknown as Record<
            string,
            unknown
          >,
          avatarFileName: avatarName,
          headerFileName: headerName
        })
      )
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
        settings: withoutInternalSettings(profile?.settings ?? {})
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
      await stage.append(
        outbox,
        orderedCollectionHead(getLocalActorOutboxId(actor.id))
      )
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
      await stage.append(
        entry,
        orderedCollectionHead(`${actor.id}/likes-archive`)
      )
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

export const bookmarksStep: CollectorStep = {
  name: 'bookmarks',
  async run(context, raw) {
    const { database, actor, stage } = context
    const cursor = (raw ?? {}) as LikesCursor
    const entry = entryPath(actor.mastodonDir, 'bookmarks.json')
    if (!cursor.started) {
      await stage.append(
        entry,
        orderedCollectionHead(`${actor.id}/bookmarks-archive`)
      )
    }

    const batch = await database.getBookmarks({
      actorId: actor.id,
      limit: context.pageSize,
      ...(cursor.maxId ? { maxId: cursor.maxId } : null)
    })
    await stage.appendJsonItems(
      entry,
      batch.map((bookmark) => bookmark.statusId)
    )
    context.stats.bookmarks += batch.length

    if (batch.length < context.pageSize) {
      await stage.append(entry, orderedCollectionTail(stage.count(entry)))
      return 'done'
    }
    return {
      cursor: {
        started: true,
        maxId: batch[batch.length - 1].id
      } satisfies LikesCursor
    }
  }
}
