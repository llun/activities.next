import { updateNoteFromUserInput } from '@/lib/actions/updateNote'
import { getBaseURL } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { MEDIA_FILE_URL_PATH } from '@/lib/services/medias/mediaFileUrl'
import { Media } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import {
  PostBoxAttachment,
  isFitnessAttachment
} from '@/lib/types/domain/attachment'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

export interface OwnedMediaPost {
  status: StatusNote
  actor: Actor
}

/**
 * The posts of `accountId` that show the media: Notes written by one of the
 * account's actors with an attachment pointing at it. `getMediaWithAttachedStatusIds`
 * already keeps only attachments written by the media owner's account; this
 * also drops anything that is not a Note. Statuses that are not the account's
 * Notes are returned in `others`.
 */
export const getOwnedMediaPosts = async ({
  database,
  statusIds,
  accountId
}: {
  database: Database
  statusIds: string[]
  accountId: string
}): Promise<{ posts: OwnedMediaPost[]; others: string[] }> => {
  const actors = new Map<string, Promise<Actor | null>>()
  const getActor = (id: string) => {
    let actor = actors.get(id)
    if (!actor) {
      actor = database.getActorFromId({ id })
      actors.set(id, actor)
    }
    return actor
  }

  const posts: OwnedMediaPost[] = []
  const others: string[] = []
  for (const statusId of statusIds) {
    const status = await database.getStatus({ statusId, withReplies: false })
    if (!status || status.type !== StatusType.enum.Note) {
      others.push(statusId)
      continue
    }
    const actor = await getActor(status.actorId)
    if (!actor || actor.account?.id !== accountId) {
      others.push(statusId)
      continue
    }
    posts.push({ status, actor })
  }
  return { posts, others }
}

const getStoredMediaUrl = (path: string) =>
  `${getBaseURL()}${MEDIA_FILE_URL_PATH}${path}`

/**
 * The status's own attachments as the composer would send them back, in
 * order, with the edited media pointing at its live file. Every other
 * attachment keeps the values the post already shows: rebuilding them from
 * their media rows would also publish another photo's "Gallery only" edit.
 * Remote and fitness attachments are not composer attachments and are left
 * out (`updateNote` keeps them).
 */
export const getRefreshedAttachments = (
  status: StatusNote,
  media: Media
): PostBoxAttachment[] =>
  status.attachments
    .filter(
      (attachment) =>
        attachment.mediaId != null && !isFitnessAttachment(attachment)
    )
    .map((attachment) => {
      const mediaId = String(attachment.mediaId)
      const base: PostBoxAttachment = {
        type: 'upload',
        id: mediaId,
        mediaType: attachment.mediaType,
        url: attachment.url,
        width: attachment.width ?? 0,
        height: attachment.height ?? 0,
        ...(attachment.name ? { name: attachment.name } : {}),
        ...(attachment.thumbnailUrl
          ? { posterUrl: attachment.thumbnailUrl }
          : {})
      }
      if (mediaId !== String(media.id)) return base
      return {
        ...base,
        mediaType: media.original.mimeType,
        url: getStoredMediaUrl(media.original.path),
        width: Number(media.original.metaData.width ?? 0),
        height: Number(media.original.metaData.height ?? 0)
      }
    })

// Whether the media is still at the edit version a refresh was started for.
const isStillLatestEdit = async (
  database: Database,
  media: Media,
  version: number,
  accountId: string
) => {
  const current = await database.getMediaByIdForAccount({
    mediaId: media.id,
    accountId
  })
  return (current?.edit?.version ?? 0) === version
}

/**
 * Points every post of the owner that shows the media at the file `media`
 * names (the render the save at `version` stored), as an ordinary edit of
 * each post: a `status_history` revision, `edited_at`, an `Update(Note)` to
 * followers and a notice to quoters. A post that cannot be updated is logged
 * and reported in `skipped`, and never fails the others.
 *
 * Once another save or revert of the media commits, the posts not reached
 * yet are left alone and reported in `skipped`: that write decides what they
 * show (it refreshes them itself, or keeps them as they are for "Gallery
 * only"), and writing this render into them afterwards would point them at a
 * file that write is free to prune.
 */
export const refreshPostsForEditedMedia = async ({
  database,
  media,
  version,
  accountId
}: {
  database: Database
  media: Media
  version: number
  accountId: string
}): Promise<{ updated: string[]; skipped: string[] }> => {
  const found = await database.getMediaWithAttachedStatusIds({
    mediaId: media.id
  })
  const statusIds = found?.statusIds ?? []
  const updated: string[] = []
  const skipped: string[] = []

  for (const [index, statusId] of statusIds.entries()) {
    try {
      if (!(await isStillLatestEdit(database, media, version, accountId))) {
        skipped.push(...statusIds.slice(index))
        break
      }
      const { posts } = await getOwnedMediaPosts({
        database,
        statusIds: [statusId],
        accountId
      })
      const post = posts[0]
      if (!post) {
        skipped.push(statusId)
        continue
      }

      const result = await updateNoteFromUserInput({
        statusId,
        currentActor: post.actor,
        attachments: getRefreshedAttachments(post.status, media),
        publish: true,
        status: post.status,
        database
      })
      if (!result) {
        skipped.push(statusId)
        continue
      }
      updated.push(statusId)
    } catch (e) {
      logger.warn({
        message: 'Failed to refresh a post for an edited photo',
        err: toLoggableError(e),
        statusId,
        mediaId: media.id
      })
      skipped.push(statusId)
    }
  }

  return { updated, skipped }
}
