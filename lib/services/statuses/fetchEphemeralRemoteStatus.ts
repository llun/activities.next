import { getNote } from '@/lib/activities'
import { BaseNote, BaseNoteSchema } from '@/lib/activities/note'
import { Database } from '@/lib/database/types'
import { recordRemoteActorBestEffort } from '@/lib/services/actors/refreshRemoteActor'
import {
  canFederateWithDomain,
  isLocalFederationDomain
} from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
import { isPublicOrUnlisted } from '@/lib/services/statusAccess'
import { StatusNote, fromNote } from '@/lib/types/domain/status'
import {
  isSameActivityPubOrigin,
  normalizeActivityPubContent
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

export type FetchEphemeralRemoteStatusParams = {
  database: Database
  statusId: string
}

/**
 * Fetch an unstored remote status live so a read-only action (translate) can
 * serve it, WITHOUT persisting it. Remote profile pages render the actor's
 * live outbox, whose statuses are never stored, so their ids miss the
 * database.
 *
 * Guards follow "A Fetched Document's Own `id` Is Not Evidence" and mirror
 * fetchQuoteTargetForCreate:
 * - only http(s) ids; local domains are never fetched;
 * - federation domain policy gates the request URL and the author;
 * - the fetched note's id must share the requested URL's origin, and its
 *   author must share the note id's origin;
 * - only public or unlisted notes are returned.
 *
 * The note is fetched with `getNote` rather than `getRemoteStatus` so the
 * author's server is not contacted before the attribution check passes. The
 * author's actor row is recorded (as search-with-resolve does) because the
 * Mastodon serializer reads the account from the database; the status itself
 * is never stored.
 */
export const fetchEphemeralRemoteStatus = async ({
  database,
  statusId
}: FetchEphemeralRemoteStatusParams): Promise<StatusNote | null> => {
  if (!isUrl(statusId)) return null

  if (await isLocalFederationDomain(database, statusId)) return null

  if (!(await canFederateWithDomain(database, statusId))) return null

  const signingActor = await getFederationSigningActorSafe(
    database,
    'for ephemeral remote status fetch'
  )

  let fetchedNote: BaseNote | null
  try {
    fetchedNote = await getNote({ statusId, signingActor })
  } catch (error) {
    logger.warn({
      message: 'Failed to fetch ephemeral remote status',
      statusId,
      err: toLoggableError(error)
    })
    return null
  }
  if (!fetchedNote) return null

  if (!isSameActivityPubOrigin(fetchedNote.id, statusId)) {
    logger.warn({
      message:
        'Ignoring fetched remote status whose id is on a different origin than requested',
      statusId,
      fetchedStatusId: fetchedNote.id
    })
    return null
  }

  const parseResult = BaseNoteSchema.safeParse(
    normalizeActivityPubContent(fetchedNote)
  )
  if (!parseResult.success) return null

  let status: StatusNote
  try {
    status = fromNote(parseResult.data)
  } catch (error) {
    logger.warn({
      message: 'Failed to convert fetched remote note to status',
      statusId,
      err: toLoggableError(error)
    })
    return null
  }

  if (!isSameActivityPubOrigin(status.actorId, status.id)) {
    logger.warn({
      message:
        'Ignoring fetched remote status whose author is on a different origin than its id',
      statusId,
      fetchedStatusId: status.id,
      actorId: status.actorId
    })
    return null
  }

  if (!(await canFederateWithDomain(database, status.actorId))) return null

  if (!isPublicOrUnlisted(status)) return null

  const actor =
    (await database.getActorFromId({ id: status.actorId })) ??
    (await recordRemoteActorBestEffort({
      actorId: status.actorId,
      database,
      signingActor
    }))
  if (!actor) return null

  return status
}
