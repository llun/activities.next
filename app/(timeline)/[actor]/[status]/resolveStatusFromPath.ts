import { cache } from 'react'

import { Database } from '@/lib/database/types'
import { isLocalDomain } from '@/lib/services/domains/localDomains'
import { Status, StatusType } from '@/lib/types/domain/status'
import { getActorIdUsername } from '@/lib/utils/activitypubActor'
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
  // The handle the actor segment named, parsed once here: build links to the
  // path's actor from it, never from the raw segment (see parseActorPathParam).
  pathActor: PathActor
}

interface PathActor {
  username: string
  domain: string
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
export const parseActorPathParam = (actorParam: string): PathActor | null => {
  const parts = decodePathParam(actorParam).split('@').slice(1)
  if (parts.length !== 2) return null

  const [username, domain] = parts
  return { username, domain }
}

// Whether a stored status's author is the actor the path names. Used only when
// the path handle has no actor row: a split-domain handle (the row's domain is
// the WebFinger handle's, not the actor id's host), a remote author whose row
// was never recorded, or a casing miss. The hydrated actor is compared when
// present; otherwise the actor id's host and last path segment stand in.
const actorMatchesPath = (status: Status, pathActor: PathActor): boolean => {
  const username = pathActor.username.toLowerCase()
  const domain = pathActor.domain.toLowerCase()

  if (
    status.actor &&
    status.actor.username.toLowerCase() === username &&
    status.actor.domain.toLowerCase() === domain
  ) {
    return true
  }

  let actorHost: string
  try {
    actorHost = new URL(status.actorId).host
  } catch {
    return false
  }
  if (actorHost !== domain) return false

  const actorUsername =
    status.actor?.username ?? getActorIdUsername(status.actorId)
  return actorUsername.toLowerCase() === username
}

const getStatusForPathActor = (
  status: Status,
  actorIdFromPath: string | undefined,
  pathActor: PathActor,
  isLocalPath: boolean
): Status | null => {
  if (actorIdFromPath) {
    if (status.actorId === actorIdFromPath) return status

    if (
      status.type === StatusType.enum.Announce &&
      status.originalStatus.actorId === actorIdFromPath
    ) {
      return status.originalStatus
    }

    return null
  }

  // No actor row for the path handle. A local path never falls back: a remote
  // row claiming a local handle must not resolve under it.
  if (isLocalPath) return null

  if (actorMatchesPath(status, pathActor)) return status

  if (
    status.type === StatusType.enum.Announce &&
    actorMatchesPath(status.originalStatus, pathActor)
  ) {
    return status.originalStatus
  }

  return null
}

// Positional arguments so React `cache()` keys on the database instance and
// primitive strings within a single request scope (e.g. between
// `generateMetadata` and `Page`).
const getActorFromUsernameCached = cache(
  (
    database: Pick<Database, 'getActorFromUsername'>,
    username: string,
    domain: string
  ) => database.getActorFromUsername({ username, domain })
)

const resolveStatusFromPathCached = cache(
  async (
    database: ResolveStatusFromPathParams['database'],
    actorParam: string,
    statusParam: string,
    currentActorId?: string
  ): Promise<ResolveStatusFromPathResult | null> => {
    const decodedStatusParam = decodePathParam(statusParam)

    const pathActor = parseActorPathParam(actorParam)
    if (!pathActor) {
      return null
    }

    // Domains are case-insensitive, and the actor lookup compares them
    // case-sensitively, so fold the path's domain before asking.
    const { username } = pathActor
    const domain = pathActor.domain.toLowerCase()
    const actorFromPath = await getActorFromUsernameCached(
      database,
      username,
      domain
    )
    const actorIdFromPath = actorFromPath?.id
    // Only needed when the handle has no actor row: a local path must never
    // fall back to a stored status, so a remote row claiming a local handle
    // cannot resolve under it.
    const isLocalPath = actorIdFromPath
      ? false
      : await isLocalDomain(null, domain)
    const isStatusHash = /^[a-f0-9]{64}$/i.test(decodedStatusParam)

    const protocol = domain.startsWith('localhost') ? 'http' : 'https'
    const isFullStatusUrl = /^https?:\/\//.test(decodedStatusParam)
    const fullStatusId = isStatusHash
      ? ''
      : isFullStatusUrl
        ? decodedStatusParam
        : `${actorFromPath?.id ?? `${protocol}://${domain}/users/${username}`}/statuses/${decodedStatusParam}`

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

      if (statusFromPublicId) {
        status = getStatusForPathActor(
          statusFromPublicId,
          actorIdFromPath,
          pathActor,
          isLocalPath
        )
      }
    }

    if (isStatusHash) {
      // A hash names a status by its url, not by the path actor, so the lookup
      // is only safe when the path actor is known: without an actor id the
      // query would run unscoped and return any status with that hash.
      if (actorIdFromPath) {
        status = await database.getStatusFromUrlHash({
          urlHash: decodedStatusParam,
          actorId: actorIdFromPath,
          currentActorId
        })

        if (!status) {
          const unscopedStatus = await database.getStatusFromUrlHash({
            urlHash: decodedStatusParam,
            currentActorId
          })

          if (unscopedStatus) {
            status = getStatusForPathActor(
              unscopedStatus,
              actorIdFromPath,
              pathActor,
              isLocalPath
            )
          }
        }
      }
    }

    if (!status && !isStatusHash) {
      const candidate = await database.getStatus({
        statusId: fullStatusId,
        withReplies: false,
        currentActorId
      })
      if (candidate) {
        status = getStatusForPathActor(
          candidate,
          actorIdFromPath,
          pathActor,
          isLocalPath
        )
      }
    }

    if (!status && !isStatusHash && !isFullStatusUrl) {
      const candidate = await database.getStatus({
        statusId: decodedStatusParam,
        currentActorId,
        withReplies: false
      })
      if (candidate) {
        status = getStatusForPathActor(
          candidate,
          actorIdFromPath,
          pathActor,
          isLocalPath
        )
      }
    }

    return {
      status,
      statusId: status?.id ?? '',
      fullStatusId,
      isStatusHash,
      pathActor
    }
  }
)

// Returns null only when the actor route cannot be parsed. Lookup misses are
// returned as { status: null } so callers can still queue remote fetches.
export const resolveStatusFromPath = ({
  database,
  actorParam,
  statusParam,
  currentActorId
}: ResolveStatusFromPathParams): Promise<ResolveStatusFromPathResult | null> =>
  resolveStatusFromPathCached(database, actorParam, statusParam, currentActorId)
