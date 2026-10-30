import type { Database } from '@/lib/database/types'
import { fetchRemoteStatus } from '@/lib/jobs/fetchRemoteStatusJob'
import { isLocalFederationDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import type { Actor } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'
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

  try {
    const signingActor = await getFederationSigningActor(database)
    await fetchRemoteStatus(database, statusId, 0, signingActor)
  } catch (err) {
    logger.warn({
      message: 'Failed to fetch remote status for action',
      statusId,
      err: toLoggableError(err)
    })
    return null
  }

  return getReadableStatus({
    database,
    statusId,
    currentActor,
    withReplies
  })
}
