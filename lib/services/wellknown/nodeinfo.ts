import { getBaseURL, getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { logger } from '@/lib/utils/logger'
import { NODE_INFO_SOFTWARE_NAME, VERSION } from '@/lib/utils/version'

export interface NodeInfoLink {
  rel: string
  href: string
}

export interface NodeInfoLinks {
  links: NodeInfoLink[]
}

/**
 * NodeInfo's protocol recommends serving the schema document with a
 * `profile`-parameterised Content-Type so strict crawlers can validate it.
 * See http://nodeinfo.diaspora.software/protocol.html.
 */
export const NODE_INFO_20_CONTENT_TYPE =
  'application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.0#"'

export const NODE_INFO_21_CONTENT_TYPE =
  'application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.1#"'

export const NODE_INFO_REPOSITORY = 'https://github.com/llun/activities.next'
export const NODE_INFO_HOMEPAGE = 'https://github.com/llun/activities.next'

export interface NodeInfoStats {
  totalUsers: number
  activeMonth: number
  activeHalfyear: number
  localPosts: number
}

export interface NodeInfo20 {
  version: '2.0'
  software: { name: string; version: string }
  protocols: string[]
  services: { inbound: string[]; outbound: string[] }
  openRegistrations: boolean
  usage: {
    users: { total: number; activeMonth: number; activeHalfyear: number }
    localPosts: number
    localComments: number
  }
  metadata: { nodeName: string; nodeDescription: string }
}

export interface NodeInfo21 extends Omit<NodeInfo20, 'version' | 'software'> {
  version: '2.1'
  software: {
    name: string
    version: string
    repository: string
    homepage: string
  }
}

/**
 * The 2.0 link is listed first: clients that only understand 2.0 take the
 * first matching link, and 2.1 is a superset of the same document.
 */
export const getNodeInfoLinks = (): NodeInfoLinks => {
  return {
    links: [
      {
        rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
        href: `${getBaseURL()}/nodeinfo/2.0`
      },
      {
        rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1',
        href: `${getBaseURL()}/nodeinfo/2.1`
      }
    ]
  }
}

export const getNodeInfo20 = (stats: NodeInfoStats): NodeInfo20 => {
  const config = getConfig()
  return {
    version: '2.0',
    software: { name: NODE_INFO_SOFTWARE_NAME, version: VERSION },
    protocols: ['activitypub'],
    services: { inbound: [], outbound: [] },
    openRegistrations: false,
    usage: {
      users: {
        total: stats.totalUsers,
        activeMonth: stats.activeMonth,
        activeHalfyear: stats.activeHalfyear
      },
      localPosts: stats.localPosts,
      localComments: 0
    },
    metadata: {
      // `||` (not `??`) so a blank serviceName falls back to the host.
      nodeName: config.serviceName || config.host,
      nodeDescription: config.serviceDescription ?? ''
    }
  }
}

/**
 * Builds the NodeInfo 2.0 document from live database statistics. Returns
 * `null` when the database is unavailable or the stats query fails so callers
 * can emit a CORS-aware 500 response instead of crashing.
 */
export const buildNodeInfo20 = async (): Promise<NodeInfo20 | null> => {
  const database = getDatabase()
  if (!database) {
    logger.error('NodeInfo 2.0 requested but the database is unavailable')
    return null
  }
  try {
    const stats = await database.getNodeInfoStats()
    return getNodeInfo20(stats)
  } catch (error) {
    logger.error({ err: error }, 'Failed to build NodeInfo 2.0 document')
    return null
  }
}

export const getNodeInfo21 = (stats: NodeInfoStats): NodeInfo21 => {
  const nodeInfo = getNodeInfo20(stats)
  return {
    ...nodeInfo,
    version: '2.1',
    software: {
      ...nodeInfo.software,
      repository: NODE_INFO_REPOSITORY,
      homepage: NODE_INFO_HOMEPAGE
    }
  }
}

/**
 * Builds the NodeInfo 2.1 document from live database statistics. Returns
 * `null` when the database is unavailable or the stats query fails so callers
 * can emit a CORS-aware 500 response instead of crashing.
 */
export const buildNodeInfo21 = async (): Promise<NodeInfo21 | null> => {
  const database = getDatabase()
  if (!database) {
    logger.error('NodeInfo 2.1 requested but the database is unavailable')
    return null
  }
  try {
    const stats = await database.getNodeInfoStats()
    return getNodeInfo21(stats)
  } catch (error) {
    logger.error({ err: error }, 'Failed to build NodeInfo 2.1 document')
    return null
  }
}
