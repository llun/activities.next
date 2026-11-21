import { getNote } from '@/lib/activities'
import { confirmActorHandle } from '@/lib/activities/confirmActorHandle'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { BaseNote, BaseNoteSchema } from '@/lib/activities/note'
import { Database } from '@/lib/database/types'
import { recordRemoteActorBestEffort } from '@/lib/services/actors/refreshRemoteActor'
import {
  canFederateWithDomain,
  isLocalFederationDomain
} from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
import { detectLanguageFromHtml } from '@/lib/services/language-detection'
import { isPublicOrUnlisted } from '@/lib/services/statusAccess'
import { Actor, ActorProfile, getActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, fromNote } from '@/lib/types/domain/status'
import {
  isSameActivityPubOrigin,
  normalizeActivityPubContent
} from '@/lib/utils/activitypub'
import { getActorProfileFromPerson } from '@/lib/utils/activitypubActor'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

export const isUrl = (value: string): boolean => {
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
  // Persist the author's actor row (with its collection counts and profile-link
  // job) when it is not stored yet. Read-only surfaces such as the public status
  // page pass false so an anonymous visitor's view writes nothing; the
  // translate route keeps the default.
  persistActor?: boolean
}

// Resolve the author profile for a verified status. A stored row is read as-is.
// Otherwise the author is either recorded (persistActor) or hydrated in memory
// with the same origin, federation-policy and WebFinger checks the recording
// path makes, but without any write.
const resolveAuthorProfile = async ({
  database,
  status,
  signingActor,
  persistActor
}: {
  database: Database
  status: StatusNote
  signingActor?: Actor
  persistActor: boolean
}): Promise<ActorProfile | null> => {
  const storedActor = await database.getActorFromId({ id: status.actorId })
  if (storedActor) return getActorProfile(storedActor)

  if (persistActor) {
    const recordedActor = await recordRemoteActorBestEffort({
      actorId: status.actorId,
      database,
      signingActor
    })
    return recordedActor ? getActorProfile(recordedActor) : null
  }

  const person = await getActorPerson({
    actorId: status.actorId,
    signingActor
  })
  if (!person) return null
  // getActorPerson proves the document is served by its own origin, not that it
  // is the actor that was asked for; a same-origin alias is still accepted.
  if (!isSameActivityPubOrigin(person.id, status.actorId)) return null
  if (!(await canFederateWithDomain(database, person.id))) return null
  // The handle is what the page renders and compares against the path actor, so
  // it must be the one WebFinger confirms — the same gate the recording path
  // applies before it creates a row.
  const handle = await confirmActorHandle({
    database,
    actorId: person.id,
    username: person.preferredUsername,
    webfinger: person.webfinger
  })
  if (!handle) return null

  return {
    ...getActorProfileFromPerson(person),
    username: handle.username,
    domain: handle.domain
  }
}

/**
 * Fetch an unstored remote status live so read-only surfaces (the status page
 * and translate) can serve it, WITHOUT persisting it. Remote profile pages
 * render the actor's live outbox, whose statuses are never stored, so their ids
 * miss the database.
 *
 * Guards follow "A Fetched Document's Own `id` Is Not Evidence" in
 * docs/mastodon-api-compatibility.md and mirror
 * fetchQuoteTargetForCreate:
 * - only http(s) ids; local domains are never fetched;
 * - federation domain policy gates the request URL and the author;
 * - the fetched note's id must share the requested URL's origin, and its
 *   author must share the note id's origin;
 * - only public or unlisted notes are returned.
 *
 * The note is fetched with `getNote` rather than `getRemoteStatus` so the
 * author's server is not contacted before the attribution and visibility checks
 * pass. Once verified, the author's actor row is recorded (as
 * search-with-resolve does) unless `persistActor` is false, in which case the
 * profile is hydrated in memory only; the status itself is never stored.
 */
export const fetchEphemeralRemoteStatus = async ({
  database,
  statusId,
  persistActor = true
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

  const actor = await resolveAuthorProfile({
    database,
    status,
    signingActor,
    persistActor
  })
  if (!actor) return null

  status.actor = actor
  // Canonicalise an alias `attributedTo` (same origin) to the resolved actor id.
  status.actorId = actor.id
  status.detectedLanguage =
    (await detectLanguageFromHtml(status.text))?.language ?? null

  return status
}
