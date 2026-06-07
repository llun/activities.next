import { getConfig } from '@/lib/config'
import { FeaturedTagWithStats } from '@/lib/types/database/operations'
import { ActorProfile } from '@/lib/types/domain/actor'
import { FeaturedTag } from '@/lib/types/mastodon/featuredTag'

const getConfiguredHost = () => {
  const host = getConfig().host
  return host.includes('://') ? new URL(host).host : host
}

// Mastodon's FeaturedTag.url is account_with_domain_url(account, "tagged/…"):
// the acct is bare for local actors and `username@domain` for remote ones, and
// the host is always the serving instance's host (resolved per-request so we
// don't hardcode it). https://docs.joinmastodon.org/entities/FeaturedTag/
const getAccountAcct = (actor: Pick<ActorProfile, 'username' | 'domain'>) => {
  const isLocal =
    actor.domain.toLowerCase() === getConfiguredHost().toLowerCase()
  return isLocal
    ? actor.username
    : `${actor.username}@${actor.domain.toLowerCase()}`
}

// Mastodon serializes last_status_at as `to_date.iso8601` — a UTC YYYY-MM-DD.
const toIsoDate = (lastStatusAt: number | null): string | null =>
  lastStatusAt === null
    ? null
    : new Date(lastStatusAt).toISOString().slice(0, 10)

// The single construction point for the Mastodon FeaturedTag entity. Every
// response that returns a FeaturedTag (account GET, list, create) must route
// through here so the shape stays consistent.
export const getMastodonFeaturedTag = ({
  host,
  actor,
  tag
}: {
  host: string
  actor: Pick<ActorProfile, 'username' | 'domain'>
  tag: FeaturedTagWithStats
}): FeaturedTag =>
  FeaturedTag.parse({
    id: tag.id,
    name: tag.name,
    url: `https://${host}/@${getAccountAcct(actor)}/tagged/${encodeURIComponent(
      tag.name
    )}`,
    statuses_count: `${tag.statusesCount}`,
    last_status_at: toIsoDate(tag.lastStatusAt)
  })
