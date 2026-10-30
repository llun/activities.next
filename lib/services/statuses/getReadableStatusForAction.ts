import { getNote } from '@/lib/activities'
import type { BaseNote } from '@/lib/activities/note'
import { isPubliclyAddressed } from '@/lib/database/domains/status/status'
import type { Database } from '@/lib/database/types'
import { dispatchCreateNoteOrPollJob } from '@/lib/jobs/dispatchCreateNoteOrPollJob'
import {
  canFederateWithDomain,
  isLocalFederationDomain
} from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import type { Actor } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'
import {
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
}

export const getReadableStatusForAction = async ({
  database,
  statusId,
  currentActor,
  withReplies
}: GetReadableStatusForActionParams): Promise<Status | null> => {
  const status = await getReadableStatus({
    database,
    statusId,
    currentActor,
    withReplies
  })
  if (status) return status

  const existing = await database.getStatus({ statusId })
  if (existing) return null

  if (!isUrl(statusId)) return null
  if (await isLocalFederationDomain(database, statusId)) return null
  if (!(await canFederateWithDomain(database, statusId))) return null

  let note: BaseNote | null
  try {
    const signingActor = await getFederationSigningActor(database)
    note = await getNote({ statusId, signingActor })
    if (!note) return null
    if (!isSameActivityPubOrigin(note.id, statusId)) return null
    if (
      !isPubliclyAddressed({
        to: toRecipientArray(note.to),
        cc: toRecipientArray(note.cc)
      })
    ) {
      return null
    }
    await dispatchCreateNoteOrPollJob(database, note)
  } catch (err) {
    logger.warn({
      message: 'Failed to fetch remote status for action',
      statusId,
      err: toLoggableError(err)
    })
    return null
  }

  const readableStatus = await getReadableStatus({
    database,
    statusId,
    currentActor,
    withReplies
  })
  if (readableStatus) return readableStatus

  if (note.id !== statusId) {
    return getReadableStatus({
      database,
      statusId: note.id,
      currentActor,
      withReplies
    })
  }

  return null
}
