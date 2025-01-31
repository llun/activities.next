import { Mention, Note } from '@llun/activities.schema'
import crypto from 'crypto'

import { getPublicProfile, sendNote } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { PostBoxAttachment } from '@/lib/models/attachment'
import { FollowStatus } from '@/lib/models/follow'
import { Status, StatusNote } from '@/lib/models/status'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMACT
} from '@/lib/utils/jsonld/activitystream'
import { logger } from '@/lib/utils/logger'
import { UNFOLLOW_NETWORK_ERROR_CODES } from '@/lib/utils/response'
import { getMentions } from '@/lib/utils/text/getMentions'
import { getSpan } from '@/lib/utils/trace'

// TODO: Support status visibility public, unlist, followers only, mentions only
export const statusRecipientsTo = (
  actor: Actor,
  replyStatus: Status | null
) => {
  if (!replyStatus) {
    return [ACTIVITY_STREAM_PUBLIC]
  }

  if (replyStatus.to.includes(ACTIVITY_STREAM_PUBLIC)) {
    return [ACTIVITY_STREAM_PUBLIC, actor.followersUrl]
  }

  if (replyStatus.to.includes(ACTIVITY_STREAM_PUBLIC_COMACT)) {
    return [ACTIVITY_STREAM_PUBLIC, actor.followersUrl]
  }

  return [replyStatus.actorId]
}

export const statusRecipientsCC = (
  actor: Actor,
  mentions: Mention[],
  replyStatus: Status | null
) => {
  if (!replyStatus) {
    return [actor.followersUrl, ...mentions.map((item) => item.href)]
  }

  if (replyStatus.cc.includes(ACTIVITY_STREAM_PUBLIC)) {
    return [actor.followersUrl, ...mentions.map((item) => item.href)]
  }

  if (replyStatus.cc.includes(ACTIVITY_STREAM_PUBLIC_COMACT)) {
    return [actor.followersUrl, ...mentions.map((item) => item.href)]
  }

  return mentions.map((item) => item.href)
}

interface CreateNoteFromUserInputParams {
  text: string
  replyNoteId?: string
  currentActor: Actor
  attachments?: PostBoxAttachment[]
  database: Database
}
export const createNoteFromUserInput = async ({
  text,
  replyNoteId,
  currentActor,
  attachments = [],
  database
}: CreateNoteFromUserInputParams) => {
  const span = getSpan('actions', 'createNoteFromUser', { text, replyNoteId })
  const replyStatus = replyNoteId
    ? await database.getStatus({ statusId: replyNoteId, withReplies: false })
    : null

  const postId = crypto.randomUUID()
  const statusId = `${currentActor.id}/statuses/${postId}`
  const mentions = await getMentions({ text, currentActor, replyStatus })

  const to = statusRecipientsTo(currentActor, replyStatus)
  const cc = statusRecipientsCC(currentActor, mentions, replyStatus)

  const createdStatus = await database.createNote({
    id: statusId,
    url: `https://${
      currentActor.domain
    }/${currentActor.getMention()}/${postId}`,

    actorId: currentActor.id,

    text,
    summary: null,

    to,
    cc,

    reply: replyStatus?.id || ''
  })

  await Promise.all([
    addStatusToTimelines(database, createdStatus),
    ...attachments.map((attachment) =>
      database.createAttachment({
        actorId: currentActor.id,
        statusId,
        mediaType: attachment.mediaType,
        url: attachment.url,
        width: attachment.width,
        height: attachment.height,
        name: attachment.name
      })
    ),
    ...mentions.map((mention) =>
      database.createTag({
        statusId,
        name: mention.name || '',
        value: mention.href,
        type: 'mention'
      })
    )
  ])

  const status = (await database.getStatus({
    statusId,
    withReplies: false
  })) as StatusNote
  if (!status) {
    span.end()
    return null
  }

  const currentActorUrl = new URL(currentActor.id)
  const remoteActorsInbox = (
    await Promise.all(
      mentions
        .filter((item) => !item.href.startsWith(currentActorUrl.origin))
        .map((item) => item.href)
        .map(async (id) => {
          const actor = await database.getActorFromId({ id })
          if (actor) return actor.sharedInboxUrl || actor.inboxUrl

          const profile = await getPublicProfile({ actorId: id })
          if (profile)
            return profile.endpoints.sharedInbox || profile.endpoints.inbox
          return null
        })
    )
  ).filter((item): item is string => item !== null)

  const followersInbox = await database.getFollowersInbox({
    targetActorId: currentActor.id
  })

  const note = getNoteFromStatus(status)
  if (!note) {
    span.end()
    return status
  }

  const inboxes = Array.from(new Set([...remoteActorsInbox, ...followersInbox]))
  await Promise.all([
    ...inboxes.map(async (inbox) => {
      try {
        await sendNote({
          currentActor,
          inbox,
          note: note as Note
        })
      } catch (e) {
        logger.error({ inbox }, `Fail to send note`)
        const nodeError = e as NodeJS.ErrnoException
        if (UNFOLLOW_NETWORK_ERROR_CODES.includes(nodeError.code ?? '')) {
          const follows = await database.getLocalFollowsFromInboxUrl({
            followerInboxUrl: inbox,
            targetActorId: currentActor.id
          })
          await Promise.all(
            follows.map((follow) =>
              database.updateFollowStatus({
                followId: follow.id,
                status: FollowStatus.enum.Rejected
              })
            )
          )
        }
      }
    })
  ])

  span.end()
  return status
}
