import { Database } from '@/lib/database/types'
import { Status, StatusType } from '@/lib/types/domain/status'
import { isPublicId } from '@/lib/utils/publicId'

interface ResolveStatusFromPathParams {
  database: Pick<
    Database,
    | 'getActorFromUsername'
    | 'getStatus'
    | 'getStatusFromUrlHash'
    | 'getStatusFromPublicId'
  >
  actorParam: string
  statusParam: string
  // The signed-in viewer, so the focused status is hydrated with their own
  // like/bookmark/reaction state. Omitted for anonymous readers.
  currentActorId?: string
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

// The username and domain an actor path segment names, or null when it does
// not parse. Only the two parts after the first '@' are read — anything before
// it is ignored — so the decoded segment itself is untrusted: build any link
// from these parts (`/@${username}@${domain}`), never from the raw segment,
// which can decode to `//host…` or `\host…` and leave the site.
export const parseActorPathParam = (actorParam: string) => {
  const parts = decodePathParam(actorParam).split('@').slice(1)
  if (parts.length !== 2) return null

  const [username, domain] = parts
  return { username, domain }
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
  statusParam,
  currentActorId
}: ResolveStatusFromPathParams): Promise<ResolveStatusFromPathResult | null> => {
  const decodedStatusParam = decodePathParam(statusParam)

  const pathActor = parseActorPathParam(actorParam)
  if (!pathActor) {
    return null
  }

  const { username, domain } = pathActor
  const actorFromPath = await database.getActorFromUsername({
    username,
    domain
  })
  const actorIdFromPath = actorFromPath?.id
  const isStatusHash = /^[a-f0-9]{64}$/i.test(decodedStatusParam)

  const protocol = domain.startsWith('localhost') ? 'http' : 'https'
  const isFullStatusUrl = /^https?:\/\//.test(decodedStatusParam)
  const fullStatusId = isStatusHash
    ? ''
    : isFullStatusUrl
      ? decodedStatusParam
      : `${protocol}://${domain}/users/${username}/statuses/${decodedStatusParam}`

  let status: Status | null = null

  // publicId paths come first: the lookup is a single unique-index hit and it
  // is the only branch that resolves a BACKFILLED status, whose URI tail is not
  // its publicId. (A status created after the flip has the publicId as its URI
  // tail, so the fullStatusId synthesis below would find it too.) The lookup is
  // not actor-scoped, so validate the path actor exactly as the unscoped hash
  // fallback does — a publicId under the wrong actor must not resolve.
  if (isPublicId(decodedStatusParam)) {
    const statusFromPublicId = await database.getStatusFromPublicId({
      publicId: decodedStatusParam,
      currentActorId
    })

    if (statusFromPublicId && actorIdFromPath) {
      status = getStatusForPathActor(statusFromPublicId, actorIdFromPath)
    }
  }

  if (isStatusHash) {
    status = await database.getStatusFromUrlHash({
      urlHash: decodedStatusParam,
      actorId: actorIdFromPath,
      currentActorId
    })

    if (!status && actorIdFromPath) {
      const unscopedStatus = await database.getStatusFromUrlHash({
        urlHash: decodedStatusParam,
        currentActorId
      })

      if (unscopedStatus) {
        status = getStatusForPathActor(unscopedStatus, actorIdFromPath)
      }
    }
  }

  if (!status && !isStatusHash) {
    status = await database.getStatus({
      statusId: fullStatusId,
      withReplies: false,
      currentActorId
    })
  }

  if (!status && !isStatusHash && !isFullStatusUrl) {
    status = await database.getStatus({
      statusId: decodedStatusParam,
      currentActorId,
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
