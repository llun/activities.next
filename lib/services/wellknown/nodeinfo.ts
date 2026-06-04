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

export const getNodeInfoLinks = (): NodeInfoLinks => {
  return {
    links: [
      {
        rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
        href: `${getBaseURL()}/nodeinfo/2.0`
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
      nodeName: config.serviceName ?? config.host,
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
  if (!database) return null
  try {
    const stats = await database.getNodeInfoStats()
    return getNodeInfo20(stats)
  } catch (error) {
    logger.error({ err: error }, 'Failed to build NodeInfo 2.0 document')
    return null
  }
}
