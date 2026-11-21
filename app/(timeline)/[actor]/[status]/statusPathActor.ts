import { Database } from '@/lib/database/types'
import {
  Status,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'

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

/**
 * Whether a status may be rendered under the actor named by the page path.
 *
 * A live-fetched status carries its author profile in memory, so the handle is
 * compared directly. A stored row may arrive without its actor hydrated; then
 * the path actor's stored id is compared with the status's actor id instead.
 * An Announce matches when either the announcer or the boosted author does.
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
  if (
    candidates.some((candidate) => handleMatches(candidate.actor, pathActor))
  ) {
    return true
  }
  // Every candidate is hydrated and none matched, so no id lookup can change
  // the answer.
  if (candidates.every((candidate) => candidate.actor)) return false

  const pathActorRow = await database.getActorFromUsername({
    username: pathActor.username,
    domain: pathActor.domain
  })
  return (
    Boolean(pathActorRow) &&
    candidates.some((candidate) => candidate.actorId === pathActorRow!.id)
  )
}
