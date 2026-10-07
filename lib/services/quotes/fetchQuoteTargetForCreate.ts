import { getNote } from '@/lib/activities'
import { BaseNote, BaseNoteSchema } from '@/lib/activities/note'
import { Database } from '@/lib/database/types'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import { createPollJob } from '@/lib/jobs/createPollJob'
import { CREATE_NOTE_JOB_NAME, CREATE_POLL_JOB_NAME } from '@/lib/jobs/names'
import {
  canFederateWithDomain,
  isLocalFederationDomain
} from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
import { isPublicOrUnlisted } from '@/lib/services/statusAccess'
import { ENTITY_TYPE_QUESTION } from '@/lib/types/activitypub'
import { Status, StatusType } from '@/lib/types/domain/status'
import {
  isSameActivityPubOrigin,
  normalizeActivityPubContent,
  toRecipientArray
} from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

const isUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

const isSupportedNoteType = (type: string): boolean =>
  type === StatusType.enum.Note ||
  type === 'Image' ||
  type === 'Page' ||
  type === 'Article' ||
  type === 'Video' ||
  type === 'Audio' ||
  type === 'Event' ||
  type === ENTITY_TYPE_QUESTION

export type FetchQuoteTargetForCreateParams = {
  database: Database
  quotedStatusId: string
}

/**
 * Fetch, verify, and store an unstored remote note or poll on demand so a quote
 * edge can reference a persistent local status row.
 *
 * Guards follow "A Fetched Document's Own `id` Is Not Evidence" and mirror
 * createAnnounceJob:
 * - skips local domains (a DB miss on our own domain does not exist);
 * - gates on federation domain policy (origin and author);
 * - enforces same-origin between the requested id and the fetched note's id;
 * - enforces same-origin between the note's id and its attributed author;
 * - requires public or unlisted audience;
 * - stores via createNoteJob/createPollJob with `skipQuoteResolution: true` to
 *   bound recursion to a single hop.
 */
export const fetchQuoteTargetForCreate = async ({
  database,
  quotedStatusId
}: FetchQuoteTargetForCreateParams): Promise<Status | null> => {
  if (!isUrl(quotedStatusId)) return null

  if (await isLocalFederationDomain(database, quotedStatusId)) {
    return null
  }

  if (!(await canFederateWithDomain(database, quotedStatusId))) {
    return null
  }

  const signingActor = await getFederationSigningActorSafe(
    database,
    'for remote quote target fetch'
  )

  let fetchedNote: BaseNote | null
  try {
    fetchedNote = await getNote({ statusId: quotedStatusId, signingActor })
  } catch (error) {
    logger.warn({
      message:
        'Failed to fetch quoted note for create; leaving status unquoted',
      quotedStatusId,
      err: toLoggableError(error)
    })
    return null
  }
  if (!fetchedNote) return null

  if (!isSameActivityPubOrigin(fetchedNote.id, quotedStatusId)) {
    logger.warn({
      message:
        'Ignoring fetched quote target whose id is on a different origin than requested',
      quotedStatusId,
      fetchedStatusId: fetchedNote.id
    })
    return null
  }

  if (!isSameActivityPubOrigin(fetchedNote.attributedTo, fetchedNote.id)) {
    logger.warn({
      message:
        'Ignoring fetched quote target whose attributedTo is on a different origin than status id',
      quotedStatusId,
      fetchedStatusId: fetchedNote.id,
      attributedTo: fetchedNote.attributedTo
    })
    return null
  }

  if (!(await canFederateWithDomain(database, fetchedNote.attributedTo))) {
    return null
  }

  const parseResult = BaseNoteSchema.safeParse(
    normalizeActivityPubContent(fetchedNote)
  )
  if (!parseResult.success) return null
  const note = parseResult.data

  if (!isSupportedNoteType(note.type)) {
    return null
  }

  const to = toRecipientArray(note.to)
  const cc = toRecipientArray(note.cc)
  if (!isPublicOrUnlisted({ to, cc })) {
    return null
  }

  try {
    if (note.type === ENTITY_TYPE_QUESTION) {
      await createPollJob(database, {
        id: note.id,
        name: CREATE_POLL_JOB_NAME,
        data: note,
        skipQuoteResolution: true
      })
    } else {
      await createNoteJob(database, {
        id: note.id,
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        skipQuoteResolution: true
      })
    }
  } catch (error) {
    logger.warn({
      message: 'Failed to persist fetched quoted note for create',
      quotedStatusId,
      err: toLoggableError(error)
    })
    return null
  }

  const storedStatus =
    (await database.getStatus({
      statusId: quotedStatusId,
      withReplies: false
    })) ??
    (await database.getStatus({
      statusId: note.id,
      withReplies: false
    }))

  return storedStatus ?? null
}
