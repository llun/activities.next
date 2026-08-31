import { Actor } from '@/lib/types/activitypub'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { withSpan } from '@/lib/utils/trace'

const domainSoftwareCache = new Map<string, string>()

export const clearServerSoftwareCache = () => {
  domainSoftwareCache.clear()
}

export const getServerSoftware = async (
  domain: string
): Promise<string | null> =>
  withSpan('federation', 'getServerSoftware', { domain }, async () => {
    const normalizedDomain = domain.trim().toLowerCase()
    if (!normalizedDomain) return null

    const cached = domainSoftwareCache.get(normalizedDomain)
    if (cached !== undefined) {
      return cached || null
    }

    try {
      const { statusCode, body } = await request({
        url: `https://${normalizedDomain}/.well-known/nodeinfo`,
        headers: {
          Accept: 'application/json, application/activity+json, */*;q=0.8',
          'User-Agent': 'activities.next'
        }
      })

      if (statusCode !== 200 || !body || typeof body !== 'string') {
        domainSoftwareCache.set(normalizedDomain, '')
        return null
      }

      const nodeInfoWellKnown = JSON.parse(body) as {
        links?: Array<{ rel?: string; href?: string }>
      }

      const nodeInfoLink =
        nodeInfoWellKnown.links?.find(
          (link) =>
            typeof link.href === 'string' &&
            (link.rel?.includes('nodeinfo') ||
              link.rel?.includes('schema.2.0') ||
              link.rel?.includes('schema.2.1'))
        ) ?? nodeInfoWellKnown.links?.[0]

      if (!nodeInfoLink?.href) {
        domainSoftwareCache.set(normalizedDomain, '')
        return null
      }

      const { statusCode: infoStatus, body: infoBody } = await request({
        url: nodeInfoLink.href,
        headers: {
          Accept: 'application/json, */*;q=0.8',
          'User-Agent': 'activities.next'
        }
      })

      if (infoStatus !== 200 || !infoBody || typeof infoBody !== 'string') {
        domainSoftwareCache.set(normalizedDomain, '')
        return null
      }

      const schema = JSON.parse(infoBody) as {
        software?: { name?: string }
      }

      const softwareName = schema.software?.name?.trim().toLowerCase() ?? ''
      domainSoftwareCache.set(normalizedDomain, softwareName)
      return softwareName || null
    } catch (error) {
      logger.warn({
        message: 'Failed to resolve server software via NodeInfo',
        domain: normalizedDomain,
        error: error instanceof Error ? error.message : String(error)
      })
      domainSoftwareCache.set(normalizedDomain, '')
      return null
    }
  })

export const isPixelfedDomain = async (domain: string): Promise<boolean> => {
  const software = await getServerSoftware(domain)
  return software === 'pixelfed'
}

export const isPixelfedActor = async (person: Actor): Promise<boolean> => {
  try {
    const actorUrl = new URL(person.id)
    return isPixelfedDomain(actorUrl.host)
  } catch {
    return false
  }
}
