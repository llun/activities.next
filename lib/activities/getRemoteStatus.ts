import { getNote } from '@/lib/activities'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getContent, getReply, getSummary } from '@/lib/activities/note'
import { Note, Question } from '@/lib/types/activitypub/objects'
import { Actor as DomainActor } from '@/lib/types/domain/actor'
import {
  Status,
  StatusNote,
  StatusPoll,
  StatusType,
  fromNote
} from '@/lib/types/domain/status'
import { normalizeActivityPubContent } from '@/lib/utils/activitypub'
import { getActorProfileFromPerson } from '@/lib/utils/activitypubActor'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { logger } from '@/lib/utils/logger'

type GetRemoteStatusParams = {
  statusId: string
  signingActor?: DomainActor
}

const POLL_FALLBACK_DURATION_MS = 100 * 365 * 24 * 60 * 60 * 1000

const publicStreams = [
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT,
  'Public',
  'as:Public'
]

const hasPublicAudience = (value: Note['to'] | Note['cc']) => {
  const items = Array.isArray(value) ? value : [value]
  return items.some((item) => publicStreams.includes(item))
}

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const getStringArray = (value: Note['to'] | Note['cc']) => {
  const items = Array.isArray(value) ? value : [value]
  return items.filter((item): item is string => typeof item === 'string')
}

const fromQuestion = (question: Question): StatusPoll => {
  const currentTime = Date.now()
  const choices = question.oneOf ?? question.anyOf ?? []
  const endAt = question.closed
    ? new Date(question.closed).getTime()
    : question.endTime
      ? new Date(question.endTime).getTime()
      : new Date(question.published).getTime() + POLL_FALLBACK_DURATION_MS

  return StatusPoll.parse({
    id: question.id,
    url: typeof question.url === 'string' ? question.url : question.id,
    actorId: question.attributedTo,
    actor: null,
    type: StatusType.enum.Poll,
    text: getContent(question),
    summary: getSummary(question),
    to: getStringArray(question.to),
    cc: getStringArray(question.cc),
    edits: [],
    reply: getReply(question.inReplyTo) || '',
    replies: [],
    attachments: [],
    tags: [],
    actorAnnounceStatusId: null,
    isActorLiked: false,
    isActorBookmarked: false,
    isLocalActor: false,
    totalLikes: 0,
    choices: choices.map((choice) => ({
      statusId: question.id,
      title: choice.name,
      totalVotes: choice.replies?.totalItems ?? 0,
      createdAt: currentTime,
      updatedAt: currentTime
    })),
    endAt,
    pollType: question.anyOf ? 'anyOf' : 'oneOf',
    createdAt: new Date(question.published).getTime(),
    updatedAt: currentTime
  })
}

export const getRemoteStatus = async ({
  statusId,
  signingActor
}: GetRemoteStatusParams): Promise<Status | null> => {
  let remoteNote: Awaited<ReturnType<typeof getNote>>
  try {
    remoteNote = await getNote({ statusId, signingActor })
  } catch (error) {
    logger.error(`[getRemoteStatus] ${getErrorMessage(error)}`)
    return null
  }
  if (!remoteNote) return null

  const remoteObject = normalizeActivityPubContent(remoteNote)
  const noteResult = Note.safeParse(remoteObject)
  const questionResult = noteResult.success
    ? null
    : Question.safeParse(remoteObject)
  const parsedObject = noteResult.success
    ? { type: 'note' as const, object: noteResult.data }
    : questionResult?.success
      ? { type: 'question' as const, object: questionResult.data }
      : null

  if (!parsedObject) {
    let parseErrorMessage = 'Remote status object did not parse'
    if (questionResult && !questionResult.success) {
      parseErrorMessage = questionResult.error.message
    } else if (!noteResult.success) {
      parseErrorMessage = noteResult.error.message
    }
    logger.error(`[getRemoteStatus] ${parseErrorMessage}`)
    return null
  }

  const object = parsedObject.object
  if (!hasPublicAudience(object.to) && !hasPublicAudience(object.cc)) {
    return null
  }

  let status: StatusNote | StatusPoll
  try {
    status =
      parsedObject.type === 'note'
        ? fromNote(parsedObject.object)
        : fromQuestion(parsedObject.object)
  } catch (error) {
    logger.error(`[getRemoteStatus] ${getErrorMessage(error)}`)
    return null
  }

  const actorPerson = await getActorPerson({
    actorId: status.actorId,
    signingActor
  }).catch((error: unknown) => {
    logger.error(`[getRemoteStatus.actor] ${getErrorMessage(error)}`)
    return null
  })
  status.actor = actorPerson ? getActorProfileFromPerson(actorPerson) : null

  return status
}
