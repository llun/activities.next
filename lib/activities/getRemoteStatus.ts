import { getNote } from '@/lib/activities'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { BaseNote, BaseNoteSchema } from '@/lib/activities/note'
import { detectLanguageFromHtml } from '@/lib/services/language-detection'
import { Actor as DomainActor } from '@/lib/types/domain/actor'
import { StatusNote, fromNote } from '@/lib/types/domain/status'
import { normalizeActivityPubContent } from '@/lib/utils/activitypub'
import { getActorProfileFromPerson } from '@/lib/utils/activitypubActor'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

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

const hasPublicAudience = (value: BaseNote['to'] | BaseNote['cc']) => {
  const items = Array.isArray(value) ? value : [value]
  return items.some((item) => publicStreams.includes(item))
}

export const getRemoteStatus = async ({
  statusId,
  signingActor
}: GetRemoteStatusParams): Promise<StatusNote | null> => {
  let remoteNote: Awaited<ReturnType<typeof getNote>>
  try {
    remoteNote = await getNote({ statusId, signingActor })
  } catch (error) {
    logger.error({
      message: 'Failed to fetch remote note',
      err: toLoggableError(error)
    })
    return null
  }
  if (!remoteNote) return null

  // getNote already canonicalises the fetched note via JSON-LD compaction.
  const noteResult = BaseNoteSchema.safeParse(
    normalizeActivityPubContent(remoteNote)
  )
  if (!noteResult.success) {
    logger.error({
      message: 'Failed to parse remote note',
      err: toLoggableError(noteResult.error)
    })
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
    logger.error({
      message: 'Failed to convert note to status',
      err: toLoggableError(error)
    })
    return null
  }
  // Ephemeral status (not persisted), so content-detected language is
  // computed here rather than read from status_detected_languages.
  status.detectedLanguage =
    detectLanguageFromHtml(status.text)?.language ?? null

  const actorPerson = await getActorPerson({
    actorId: status.actorId,
    signingActor
  }).catch((error: unknown) => {
    logger.error({
      message: 'Failed to get actor person',
      err: toLoggableError(error)
    })
    return null
  })
  status.actor = actorPerson ? getActorProfileFromPerson(actorPerson) : null

  return status
}
