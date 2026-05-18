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

const persistRemoteStatus = async ({
  database,
  status
}: {
  database: Database
  status: Status
}) => {
  if (status.type === StatusType.enum.Note) {
    return database.createNote({
      id: status.id,
      url: status.url,
      actorId: status.actorId,
      text: status.text,
      summary: status.summary ?? '',
      to: status.to,
      cc: status.cc,
      reply: status.reply,
      createdAt: status.createdAt
    })
  }

  if (status.type === StatusType.enum.Poll) {
    return database.createPoll({
      id: status.id,
      url: status.url,
      actorId: status.actorId,
      text: status.text,
      summary: status.summary ?? '',
      to: status.to,
      cc: status.cc,
      reply: status.reply,
      choices: status.choices.map((choice) => choice.title),
      endAt: status.endAt,
      pollType: status.pollType,
      createdAt: status.createdAt
    })
  }

  return null
}

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

  const statusDomain = new URL(statusUrl).hostname
  if (!(await canFederateWithDomain(database, statusDomain))) return null

  const signingActor = await getFederationSigningActor(database)
  const remoteStatus = await getRemoteStatus({
    statusId: statusUrl,
    signingActor: signingActor ?? undefined
  })
  if (!remoteStatus || !isSearchableStatus(remoteStatus)) return null
  const resolvedRemoteStatus: Status = remoteStatus

  const actor = await recordActorIfNeeded({
    actorId: resolvedRemoteStatus.actorId,
    database,
    signingActor: signingActor ?? undefined
  })
  if (!actor) return null

  try {
    await persistRemoteStatus({
      database,
      status: resolvedRemoteStatus
    })
  } catch (error) {
    // Persist is best-effort: concurrent resolves can race on insert, so
    // continue and read back the canonical row before indexing.
    logger.warn({
      message: 'Failed to persist resolved status for search',
      statusId: resolvedRemoteStatus.id,
      error: error instanceof Error ? error.message : String(error)
    })
  }

  const persistedStatus =
    (await database.getStatus({ statusId: resolvedRemoteStatus.id })) ??
    (await database.getStatusFromUrl({ url: statusUrl }))
  if (!persistedStatus || !isSearchableStatus(persistedStatus)) return null

  await database.upsertStatusSearchDocument({ statusId: persistedStatus.id })
  return persistedStatus
}
