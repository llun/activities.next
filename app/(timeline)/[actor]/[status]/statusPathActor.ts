import { Database } from '@/lib/database/types'
import {
  Status,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'

import { getActorFromUsernameCached } from './resolveStatusFromPath'

export interface PathActorHandle {
  username: string
  domain: string
}

interface StatusActor {
  actorId: string
  actor?: { username: string; domain: string } | null
}

const handleMatches = (
  actor: { username?: string; domain?: string } | null | undefined,
  pathActor: PathActorHandle
) =>
  Boolean(actor?.username && actor?.domain) &&
  actor!.username!.toLowerCase() === pathActor.username.toLowerCase() &&
  actor!.domain!.toLowerCase() === pathActor.domain.toLowerCase()

// The actors a status may legitimately be shown under: the announcer and, for
// an Announce, the boosted status's author.
const candidateActors = (status: Status): StatusActor[] => {
  const candidates: StatusActor[] = [
    { actorId: status.actorId, actor: status.actor }
  ]
  if (status.type === StatusType.enum.Announce) {
    const original = getOriginalStatus(status)
    candidates.push({ actorId: original.actorId, actor: original.actor })
  }
  return candidates
}

// The stored row for the handle the path names. A domain is case-insensitive,
// but the actors lookup matches it exactly, so a path spelling it in another
// case (`@Alice@ACTIVITIES.LOCAL`) would miss the row and fall through to the
// ledger or folded arms — resolving a case-variant twin, or nothing at all for
// a stored remote actor. Ask with the lowercased domain first, then the raw
// spelling only when it differs, for a legacy row stored with mixed case.
const getPathActorRow = async (
  database: Pick<Database, 'getActorFromUsername'>,
  pathActor: PathActorHandle
) => {
  const lowerDomain = pathActor.domain.toLowerCase()
  const row = await getActorFromUsernameCached(
    database,
    pathActor.username,
    lowerDomain
  )
  if (row || lowerDomain === pathActor.domain) return row
  return getActorFromUsernameCached(
    database,
    pathActor.username,
    pathActor.domain
  )
}

/**
 * Whether a status may be rendered under the actor named by the page path.
 *
 * The path actor's stored id is the authority whenever it resolves. A handle is
 * case-insensitive and a renamed actor keeps its old one resolving, so comparing
 * the strings alone would accept a case-variant twin's post (`Alice` under
 * `alice`) and reject a renamed actor's post under the handle it gave up. Only
 * when the path actor is not stored — a remote author hydrated in memory — is
 * the WebFinger-confirmed handle the only thing left to compare. An Announce
 * matches when either the announcer or the boosted author does.
 */
export const statusMatchesPathActor = async ({
  database,
  status,
  pathActor
}: {
  database: Pick<Database, 'getActorFromUsername'>
  status: Status
  pathActor: PathActorHandle
}): Promise<boolean> => {
  const candidates = candidateActors(status)
  const pathActorRow = await getPathActorRow(database, pathActor)
  if (pathActorRow) {
    return candidates.some((candidate) => candidate.actorId === pathActorRow.id)
  }
  return candidates.some((candidate) =>
    handleMatches(candidate.actor, pathActor)
  )
}
