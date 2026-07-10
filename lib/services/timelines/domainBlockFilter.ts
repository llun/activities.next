import { Status } from '@/lib/types/domain/status'

import { getRelevantStatusActorIds } from './blockFilter'

// Domains a status surfaces content from: the author's domain plus, for a
// boost, the boosted author's domain. Compared against the viewer's
// user-level domain blocks (`actor_domain_blocks.domain`, which stores
// normalized hostnames matching `new URL(actorId).host`).
export const getRelevantStatusDomains = (status: Status): string[] => [
  ...new Set(
    getRelevantStatusActorIds(status).flatMap((actorId) => {
      try {
        return [new URL(actorId).host]
      } catch {
        return []
      }
    })
  )
]

export const filterDomainBlockedStatuses = (
  blockedDomains: ReadonlySet<string>,
  statuses: Status[]
): Status[] => {
  if (blockedDomains.size === 0) return statuses
  return statuses.filter(
    (status) =>
      !getRelevantStatusDomains(status).some((domain) =>
        blockedDomains.has(domain)
      )
  )
}
