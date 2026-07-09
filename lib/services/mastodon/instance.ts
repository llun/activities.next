import type { Config } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { Mastodon } from '@/lib/types/activitypub'
import { logger } from '@/lib/utils/logger'

export interface InstanceStats {
  userCount: number
  statusCount: number
  domainCount: number
  activeMonth: number
}

// Frozen: getInstanceStats returns this shared constant by reference on the
// no-database / query-failure paths, so a caller mutating the result must not
// be able to corrupt the singleton.
export const EMPTY_INSTANCE_STATS: Readonly<InstanceStats> = Object.freeze({
  userCount: 0,
  statusCount: 0,
  domainCount: 0,
  activeMonth: 0
})

// Normalizes VAPID-style `mailto:` prefixes and `Name <address>` sender
// formats down to the bare address.
const extractEmailAddress = (value: string): string => {
  const withoutMailto = value.startsWith('mailto:')
    ? value.slice('mailto:'.length)
    : value
  const bracketed = withoutMailto.match(/<([^<>\s]+@[^<>\s]+)>/)
  return (bracketed ? bracketed[1] : withoutMailto).trim()
}

// There is no dedicated instance-contact setting in the config, so fall back
// through the configured outbound sender address, then the Web Push VAPID
// contact. An empty string means no contact is configured.
export const getInstanceContactEmail = (
  config: Pick<Config, 'email' | 'push'>
): string => {
  const candidate =
    config.email?.serviceFromAddress || config.push?.vapidEmail || ''
  return extractEmailAddress(candidate)
}

// Instance stats for the v1 entity and the v2 usage block. All sources are
// cheap: user/status totals come from the maintained nodeinfo counters,
// active_month reuses the hourly-cached nodeinfo computation (distinct local
// actors with a status in the last 30 days) and domain count is the length
// of the peers list. Failures degrade to zeros because the public instance
// endpoints must never 500 over a stats query.
export const getInstanceStats = async (
  database: Database | null,
  localDomain: string
): Promise<InstanceStats> => {
  if (!database) return EMPTY_INSTANCE_STATS
  try {
    const [nodeInfoStats, peers] = await Promise.all([
      database.getNodeInfoStats(),
      database.getInstancePeers({ localDomain })
    ])
    return {
      userCount: nodeInfoStats.totalUsers,
      statusCount: nodeInfoStats.localPosts,
      domainCount: peers.length,
      activeMonth: nodeInfoStats.activeMonth
    }
  } catch (error) {
    logger.warn({
      message: 'Failed to load instance stats',
      error: error instanceof Error ? error.message : String(error)
    })
    return EMPTY_INSTANCE_STATS
  }
}

// The instance contact account is the earliest-created local actor owned by
// an account with the admin role, or null when the instance has no admin.
export const getInstanceContactAccount = async (
  database: Database | null
): Promise<Mastodon.Account | null> => {
  if (!database) return null
  try {
    const actorId = await database.getInstanceAdminActorId()
    if (!actorId) return null
    return await database.getMastodonActorFromId({ id: actorId })
  } catch (error) {
    logger.warn({
      message: 'Failed to load instance contact account',
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}
