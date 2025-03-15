import { Mention } from '@llun/activities.schema'
import crypto from 'crypto'

import { Database } from '@/lib/database/types'
import { SEND_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { Actor, getMention } from '@/lib/models/actor'
import { PostBoxAttachment } from '@/lib/models/attachment'
import { Status, StatusNote } from '@/lib/models/status'
import { getQueue } from '@/lib/services/queue'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMACT
} from '@/lib/utils/jsonld/activitystream'
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
    url: `https://${currentActor.domain}/${getMention(currentActor)}/${postId}`,

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

  await getQueue().publish({
    id: getHashFromString(status.id),
    name: SEND_NOTE_JOB_NAME,
    data: {
      actorId: currentActor.id,
      statusId: status.id
    }
  })

  span.end()
  return status
}
