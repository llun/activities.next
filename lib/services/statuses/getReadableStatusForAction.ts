import { getNote } from '@/lib/activities'
import type { BaseNote } from '@/lib/activities/note'
import { isPubliclyAddressed } from '@/lib/database/domains/status/status'
import type { Database } from '@/lib/database/types'
import { dispatchCreateNoteOrPollJob } from '@/lib/jobs/dispatchCreateNoteOrPollJob'
import { isLocalDomain } from '@/lib/services/domains/localDomains'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
import { rethrowIfFederationPolicyUnavailable } from '@/lib/services/federation/policyUnavailable'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import type { Actor } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'
import {
  extractActivityPubId,
  isSameActivityPubOrigin,
  toRecipientArray
} from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { isUrl } from './fetchEphemeralRemoteStatus'

interface GetReadableStatusForActionParams {
  database: Database
  statusId: string
  currentActor: Actor | null
  withReplies?: boolean
  /**
   * When set, a fetched remote note whose `type` does not match is refused
   * (no dispatch, nothing handed back). Lets poll endpoints reject fetched
   * non-Question notes instead of storing them as ordinary statuses.
   */
  requireType?: 'Question'
}

export type GetReadableStatusAndFetchedNoteResult = {
  status: Status | null
  /**
   * The fetched remote note, set ONLY when it was fetched AND passed these
   * checks: its id is on the same origin as the requested id, its author
   * shares the note id's origin, the author's domain passes federation
   * policy, and the note is publicly addressed. Null when the helper refused
   * before fetching or the fetch itself failed. Lets a caller whose storage /
   * re-read attempt failed (`status: null`) build an ephemeral status from
   * the note without re-fetching the same URL.
   */
  fetchedNote: BaseNote | null
}

export const getReadableStatusAndFetchedNoteForAction = async ({
  database,
  statusId,
  currentActor,
  withReplies,
  requireType
}: GetReadableStatusForActionParams): Promise<GetReadableStatusAndFetchedNoteResult> => {
  const status = await getReadableStatus({
    database,
    statusId,
    currentActor,
    withReplies
  })
  if (status) return { status, fetchedNote: null }

  const existing = await database.getStatus({ statusId, withReplies: false })
  if (existing) return { status: null, fetchedNote: null }

  if (!isUrl(statusId)) return { status: null, fetchedNote: null }
  if (await isLocalDomain(database, statusId)) {
    return { status: null, fetchedNote: null }
  }
  if (!(await canFederateWithDomain(database, statusId))) {
    return { status: null, fetchedNote: null }
  }

  // Assigned only after every check below has passed, so the catch cannot hand
  // out a note that failed one of them (a throw from the author-domain policy
  // lookup, say) — search would otherwise render it. Once assigned, the note is
  // handed out even when the store step or the re-read below fails.
  let note: BaseNote | null = null
  try {
    const signingActor = await getFederationSigningActorSafe(
      database,
      'for remote status action'
    )
    const fetchedNote = await getNote({ statusId, signingActor })
    if (!fetchedNote) return { status: null, fetchedNote: null }
    if (!isSameActivityPubOrigin(fetchedNote.id, statusId)) {
      return { status: null, fetchedNote: null }
    }
    // The note's author must share the note id's origin, or search would show
    // an ephemeral status under a forged author (same check as dispatch).
    const authorId = extractActivityPubId(fetchedNote.attributedTo)
    if (!authorId || !isSameActivityPubOrigin(authorId, fetchedNote.id)) {
      return { status: null, fetchedNote: null }
    }
    // The author's server must also pass federation domain policy, like the
    // requested id did before the fetch.
    if (!(await canFederateWithDomain(database, authorId))) {
      return { status: null, fetchedNote: null }
    }
    if (
      !isPubliclyAddressed({
        to: toRecipientArray(fetchedNote.to),
        cc: toRecipientArray(fetchedNote.cc)
      })
    ) {
      return { status: null, fetchedNote: null }
    }
    if (requireType && fetchedNote.type !== requireType) {
      return { status: null, fetchedNote: null }
    }
    // Every check passed: from here the note may be handed out.
    note = fetchedNote
    await dispatchCreateNoteOrPollJob(database, note)
  } catch (err) {
    // A 5xx to try again, not a 404 for a status that may well exist.
    rethrowIfFederationPolicyUnavailable(err)
    logger.warn({
      message: 'Failed to fetch remote status for action',
      statusId,
      err: toLoggableError(err)
    })
    // A throw before every check passed leaves note null; a throw from the
    // store step leaves the checked note set for the ephemeral fallback.
    return { status: null, fetchedNote: note }
  }

  const readableStatus = await getReadableStatus({
    database,
    statusId,
    currentActor,
    withReplies
  })
  if (readableStatus) return { status: readableStatus, fetchedNote: note }

  if (note.id !== statusId) {
    const aliasStatus = await getReadableStatus({
      database,
      statusId: note.id,
      currentActor,
      withReplies
    })
    if (aliasStatus) return { status: aliasStatus, fetchedNote: note }
  }

  return { status: null, fetchedNote: note }
}

export const getReadableStatusForAction = async (
  params: GetReadableStatusForActionParams
): Promise<Status | null> =>
  (await getReadableStatusAndFetchedNoteForAction(params)).status
