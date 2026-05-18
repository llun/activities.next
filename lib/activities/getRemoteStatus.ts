import { getNote } from '@/lib/activities'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { Note } from '@/lib/types/activitypub/objects'
import { normalizeActivityPubContent } from '@/lib/utils/activitypub'
import { getActorProfileFromPerson } from '@/lib/utils/activitypubActor'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { logger } from '@/lib/utils/logger'

import { Actor as DomainActor } from '../types/domain/actor'
import { Status, StatusNote, fromNote } from '../types/domain/status'

type GetRemoteStatusParams = {
  statusId: string
  signingActor?: DomainActor
}

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

  const noteResult = Note.safeParse(normalizeActivityPubContent(remoteNote))
  if (!noteResult.success) {
    logger.error(`[getRemoteStatus] ${noteResult.error.message}`)
    return null
  }

  const note = noteResult.data
  if (!hasPublicAudience(note.to) && !hasPublicAudience(note.cc)) {
    return null
  }

  let status: StatusNote
  try {
    status = fromNote(note)
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
