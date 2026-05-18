import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getRemoteStatus } from '@/lib/activities/getRemoteStatus'
import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { Status, StatusType } from '@/lib/types/domain/status'
import { getVisibility } from '@/lib/utils/getVisibility'
import { logger } from '@/lib/utils/logger'

type ResolveStatusForSearchParams = {
  database: Database
  query: string
}

const getStatusUrl = (query: string) => {
  let url: URL
  try {
    url = new URL(query.trim())
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.toString()
}

const isSearchableStatus = (status: Status) => {
  if (
    status.type !== StatusType.enum.Note &&
    status.type !== StatusType.enum.Poll
  ) {
    return false
  }

  const visibility = getVisibility(status.to, status.cc)
  return visibility === 'public' || visibility === 'unlisted'
}

const getExistingStatusForUrl = async (database: Database, url: string) =>
  (await database.getStatus({ statusId: url })) ??
  (await database.getStatusFromUrl({ url }))

export const resolveStatusForSearch = async ({
  database,
  query
}: ResolveStatusForSearchParams): Promise<Status | null> => {
  const statusUrl = getStatusUrl(query)
  if (!statusUrl) return null

  const existingStatus = await getExistingStatusForUrl(database, statusUrl)
  if (existingStatus) {
    if (!isSearchableStatus(existingStatus)) return null

    await database.upsertStatusSearchDocument({ statusId: existingStatus.id })
    return existingStatus
  }

  if (!(await canFederateWithDomain(database, statusUrl))) return null

  const signingActor = await getFederationSigningActor(database)
  const remoteStatus = await getRemoteStatus({
    statusId: statusUrl,
    signingActor: signingActor ?? undefined
  })
  if (!remoteStatus || !isSearchableStatus(remoteStatus)) return null

  const actor = await recordActorIfNeeded({
    actorId: remoteStatus.actorId,
    database,
    signingActor: signingActor ?? undefined
  })
  if (!actor) return null

  try {
    await database.createNote({
      id: remoteStatus.id,
      url: remoteStatus.url,
      actorId: remoteStatus.actorId,
      text: remoteStatus.text,
      summary: remoteStatus.summary ?? '',
      to: remoteStatus.to,
      cc: remoteStatus.cc,
      reply: remoteStatus.reply,
      createdAt: remoteStatus.createdAt
    })
  } catch (error) {
    logger.warn({
      message: 'Failed to persist resolved status for search',
      statusId: remoteStatus.id,
      error: error instanceof Error ? error.message : String(error)
    })
  }

  const persistedStatus =
    (await database.getStatus({ statusId: remoteStatus.id })) ??
    (await database.getStatusFromUrl({ url: statusUrl }))
  if (!persistedStatus || !isSearchableStatus(persistedStatus)) return null

  await database.upsertStatusSearchDocument({ statusId: persistedStatus.id })
  return persistedStatus
}
