import { Database } from '@/lib/database/types'
import { normalizeDomain } from '@/lib/services/federation/domainRules'
import {
  filterDomainBlockedStatuses,
  getRelevantStatusDomains
} from '@/lib/services/timelines/domainBlockFilter'
import { Status } from '@/lib/types/domain/status'

// The domain rules post search applies after the query, with the federation
// policy's own matching (wildcard rules, ports, an author stored under another
// handle domain), which SQL would have to copy:
// - the viewer's user-level domain blocks hide every result from that domain,
//   as they do on the timelines;
// - an instance domain block (suspend or silence) hides a post the viewer did
//   not write, like or bookmark: such a post can only be there as an opted-in
//   public post, and the public surfaces leave silenced domains out.
export const filterSearchStatuses = async ({
  database,
  viewerId,
  statuses
}: {
  database: Database
  viewerId: string
  statuses: Status[]
}): Promise<Status[]> => {
  if (statuses.length === 0) return statuses

  const blockedDomains = new Set(
    (await database.getActorDomainBlocks({ actorId: viewerId })).map(
      (block) => block.domain
    )
  )
  const domainFiltered = filterDomainBlockedStatuses(blockedDomains, statuses)

  // Search returns Notes and Polls only, which carry the viewer's own flags.
  const isLibrary = (status: Status) =>
    status.actorId === viewerId ||
    ('isActorLiked' in status && Boolean(status.isActorLiked)) ||
    ('isActorBookmarked' in status && Boolean(status.isActorBookmarked))
  const publicDomains = [
    ...new Set(
      domainFiltered
        .filter((status) => !isLibrary(status))
        .flatMap(getRelevantStatusDomains)
    )
  ]
  if (publicDomains.length === 0) return domainFiltered

  const rules = await database.getDomainBlocksForDomains(publicDomains)
  const isBlockedDomain = (domain: string) => {
    const normalized = normalizeDomain(domain)
    const rule = normalized ? rules[normalized] : null
    return rule?.severity === 'suspend' || rule?.severity === 'silence'
  }
  return domainFiltered.filter(
    (status) =>
      isLibrary(status) ||
      !getRelevantStatusDomains(status).some(isBlockedDomain)
  )
}
