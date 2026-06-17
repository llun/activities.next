import { Database } from '@/lib/database/types'
import { aliasServedLocalActor } from '@/lib/services/actors/aliasServedLocalActor'
import { Status, StatusType } from '@/lib/types/domain/status'

interface ResolveStatusFromPathParams {
  database: Pick<
    Database,
    'getActorFromUsername' | 'getStatus' | 'getStatusFromUrlHash'
  >
  actorParam: string
  statusParam: string
}

interface ResolveStatusFromPathResult {
  status: Status | null
  statusId: string
  fullStatusId: string
  isStatusHash: boolean
}

export const decodePathParam = (param: string) => {
  try {
    return decodeURIComponent(param)
  } catch {
    return param
  }
}

const getStatusForPathActor = (status: Status, actorId: string) => {
  if (status.actorId === actorId) return status

  if (
    status.type === StatusType.enum.Announce &&
    status.originalStatus.actorId === actorId
  ) {
    return status.originalStatus
  }

  return null
}

// Returns null only when the actor route cannot be parsed. Lookup misses are
// returned as { status: null } so callers can still queue remote fetches.
export const resolveStatusFromPath = async ({
  database,
  actorParam,
  statusParam
}: ResolveStatusFromPathParams): Promise<ResolveStatusFromPathResult | null> => {
  const decodedActor = decodePathParam(actorParam)
  const decodedStatusParam = decodePathParam(statusParam)

  const parts = decodedActor.split('@').slice(1)
  if (parts.length !== 2) {
    return null
  }

  const [username, domain] = parts
  let actorFromPath = await database.getActorFromUsername({
    username,
    domain
  })

  // No local actor on the queried domain: if it is a host this instance serves
  // as (a trusted alias of the canonical host), resolve to the canonical local
  // actor. Mirrors the WebFinger/lookup/search routes; `?? actorFromPath` keeps
  // a genuinely-remote row untouched.
  if (!actorFromPath?.privateKey) {
    actorFromPath =
      (await aliasServedLocalActor({ database, username, domain })) ??
      actorFromPath
  }

  const actorIdFromPath = actorFromPath?.id
  const isStatusHash = /^[a-f0-9]{64}$/i.test(decodedStatusParam)

  // Build the canonical status URL from the RESOLVED actor's domain/username,
  // not the host the request came in on: an alias host would otherwise produce a
  // URL no getStatus lookup can match. Fall back to the queried path when no
  // actor resolved.
  const canonicalUsername = actorFromPath?.username ?? username
  const canonicalDomain = actorFromPath?.domain ?? domain
  const protocol = canonicalDomain.startsWith('localhost') ? 'http' : 'https'
  const isFullStatusUrl = /^https?:\/\//.test(decodedStatusParam)
  const fullStatusId = isStatusHash
    ? ''
    : isFullStatusUrl
      ? decodedStatusParam
      : `${protocol}://${canonicalDomain}/users/${canonicalUsername}/statuses/${decodedStatusParam}`

  let status: Status | null = null

  if (isStatusHash) {
    status = await database.getStatusFromUrlHash({
      urlHash: decodedStatusParam,
      actorId: actorIdFromPath
    })

    if (!status && actorIdFromPath) {
      const unscopedStatus = await database.getStatusFromUrlHash({
        urlHash: decodedStatusParam
      })

      if (unscopedStatus) {
        status = getStatusForPathActor(unscopedStatus, actorIdFromPath)
      }
    }
  }

  if (!status && !isStatusHash) {
    status = await database.getStatus({
      statusId: fullStatusId,
      withReplies: false
    })
  }

  if (!status && !isStatusHash && !isFullStatusUrl) {
    status = await database.getStatus({
      statusId: decodedStatusParam,
      withReplies: false
    })
  }

  return {
    status,
    statusId: status?.id ?? '',
    fullStatusId,
    isStatusHash
  }
}
