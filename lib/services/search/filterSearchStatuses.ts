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
// - an instance domain block (suspend or silence) hides a post outside the
//   viewer's library: such a post can only be there as an opted-in public post
//   (or a URL the viewer resolved), and the public surfaces leave silenced
//   domains out.
// searchStatusIds already applies the common shapes of both in the query, so
// pages stay full; this catches what it does not see (the id host of an author
// stored under another handle domain).
export const filterSearchStatuses = async ({
  database,
  viewerId,
  viewerUsername,
  viewerDomain,
  statuses
}: {
  database: Database
  viewerId: string
  viewerUsername?: string | null
  viewerDomain?: string | null
  statuses: Status[]
}): Promise<Status[]> => {
  if (statuses.length === 0) return statuses

  const blockedDomains = new Set(
    (await database.getActorDomainBlocks({ actorId: viewerId })).map(
      (block) => block.domain
    )
  )
  const domainFiltered = filterDomainBlockedStatuses(blockedDomains, statuses)

  // The forms a mention of the viewer is stored under, as searchStatusIds
  // matches them; a bare `@username` is left out, as it names an account on
  // the author's own server.
  const mentionValues = new Set([
    viewerId,
    `${viewerId}/`,
    ...(viewerUsername && viewerDomain
      ? [
          `https://${viewerDomain}/@${viewerUsername}`,
          `https://${viewerDomain}/@${viewerUsername}@${viewerDomain}`,
          `@${viewerUsername}@${viewerDomain}`
        ]
      : [])
  ])
  // The viewer's library: written, liked, bookmarked or mentioning them. Search
  // returns Notes and Polls only, which carry the viewer's own flags and tags.
  const isLibrary = (status: Status) =>
    status.actorId === viewerId ||
    ('isActorLiked' in status && Boolean(status.isActorLiked)) ||
    ('isActorBookmarked' in status && Boolean(status.isActorBookmarked)) ||
    ('tags' in status &&
      status.tags.some(
        (tag) =>
          tag.type === 'mention' &&
          (mentionValues.has(tag.value ?? '') ||
            (!tag.value && mentionValues.has(tag.name)))
      ))
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
