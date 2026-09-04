import { Actor } from '@/lib/types/activitypub'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

export interface ServerSoftware {
  name: string
  version: string | null
}

type CacheEntry = {
  // null is the negative-cache value (probe failed / not resolvable), kept
  // distinct from "not cached" so a failure does not re-probe until it expires.
  software: ServerSoftware | null
  expiresAt: number
}

// A resolved software name barely changes, so hold it a day; a failure was
// often transient, so re-probe after a few minutes rather than marking a real
// instance non-Pixelfed forever. The pre-TTL cache stored the '' failure
// sentinel as a permanent HIT, which is exactly that bug.
export const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000
export const FAILURE_TTL_MS = 5 * 60 * 1000

// The entries expire but nothing sweeps them, and NodeInfo is probed for
// whichever domains remote actors bring in. Bound the map so a long-lived
// process cannot accumulate one entry per domain it has ever seen. Mirrors
// `MAX_CACHED_ACTORS` in `lib/services/statuses/actorPublicStatusesCount.ts`.
export const MAX_CACHED_DOMAINS = 512

const domainSoftwareCache = new Map<string, CacheEntry>()

// Insertion-order eviction, mirroring `setBoundedEntry` in
// `actorPublicStatusesCount.ts` and `setBoundedCacheValue` in
// `lib/utils/host.ts` — both are private to their own domains, so this is a
// deliberate copy rather than an export widened for one caller.
const setBoundedEntry = (
  domain: string,
  software: ServerSoftware | null,
  ttlMs: number
) => {
  if (domainSoftwareCache.has(domain)) {
    domainSoftwareCache.delete(domain)
  } else if (domainSoftwareCache.size >= MAX_CACHED_DOMAINS) {
    const oldestDomain = domainSoftwareCache.keys().next().value
    if (oldestDomain !== undefined) domainSoftwareCache.delete(oldestDomain)
  }

  domainSoftwareCache.set(domain, {
    software,
    expiresAt: Date.now() + ttlMs
  })
}

// A NodeInfo document is served by the instance itself, so its discovery link
// must point back at the same host. Following a cross-host href would let a
// hostile `.well-known/nodeinfo` redirect the probe at an arbitrary server. The
// `typeof href === 'string'` guard was missing on the old rel-less fallback.
const isSameHostNodeInfoLink = (
  link: { rel?: string; href?: string } | null | undefined,
  expectedHost: string
): boolean => {
  if (typeof link?.href !== 'string') return false
  try {
    const resolved = new URL(link.href, `https://${expectedHost}`)
    return resolved.host.toLowerCase() === expectedHost
  } catch {
    return false
  }
}

export const clearServerSoftwareCache = () => {
  domainSoftwareCache.clear()
}

export const getServerSoftwareCacheSizeForTests = () => domainSoftwareCache.size

export const getServerSoftwareInfo = async (
  domain: string
): Promise<ServerSoftware | null> =>
  withSpan('federation', 'getServerSoftwareInfo', { domain }, async () => {
    const normalizedDomain = domain.trim().toLowerCase()
    if (!normalizedDomain) return null

    const cached = domainSoftwareCache.get(normalizedDomain)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.software
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
        setBoundedEntry(normalizedDomain, null, FAILURE_TTL_MS)
        return null
      }

      const nodeInfoWellKnown = JSON.parse(body) as {
        links?: Array<{ rel?: string; href?: string }>
      }

      const links = Array.isArray(nodeInfoWellKnown?.links)
        ? nodeInfoWellKnown.links
        : []
      const nodeInfoLink =
        links.find(
          (link) =>
            isSameHostNodeInfoLink(link, normalizedDomain) &&
            (link.rel?.includes('nodeinfo') ||
              link.rel?.includes('schema.2.0') ||
              link.rel?.includes('schema.2.1'))
        ) ??
        // Compatibility fallback for a server that omits a recognizable rel:
        // the first link regardless of rel, but still pinned to this host.
        links.find((link) => isSameHostNodeInfoLink(link, normalizedDomain))

      if (!nodeInfoLink?.href) {
        setBoundedEntry(normalizedDomain, null, FAILURE_TTL_MS)
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
        setBoundedEntry(normalizedDomain, null, FAILURE_TTL_MS)
        return null
      }

      const schema = JSON.parse(infoBody) as {
        software?: { name?: unknown; version?: unknown }
      }

      const rawName =
        typeof schema?.software?.name === 'string'
          ? schema.software.name.trim().toLowerCase().slice(0, 100)
          : ''

      if (!rawName) {
        setBoundedEntry(normalizedDomain, null, FAILURE_TTL_MS)
        return null
      }

      const rawVersion =
        typeof schema?.software?.version === 'string'
          ? schema.software.version.trim().slice(0, 100)
          : null
      const version = rawVersion || null

      const software: ServerSoftware = {
        name: rawName,
        version
      }

      setBoundedEntry(normalizedDomain, software, SUCCESS_TTL_MS)
      return software
    } catch (error) {
      logger.warn({
        message: 'Failed to resolve server software via NodeInfo',
        domain: normalizedDomain,
        err: toLoggableError(error)
      })
      setBoundedEntry(normalizedDomain, null, FAILURE_TTL_MS)
      return null
    }
  })

export const getServerSoftware = async (
  domain: string
): Promise<string | null> => {
  const info = await getServerSoftwareInfo(domain)
  return info?.name ?? null
}

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

export const isPeerTubeDomain = async (domain: string): Promise<boolean> => {
  const software = await getServerSoftware(domain)
  return software === 'peertube'
}

export const isPeerTubeActor = async (person: Actor): Promise<boolean> => {
  try {
    const actorUrl = new URL(person.id)
    return isPeerTubeDomain(actorUrl.host)
  } catch {
    return false
  }
}

const MISSKEY_FAMILY_SOFTWARE = new Set([
  'misskey',
  'sharkey',
  'firefish',
  'iceshrimp',
  'calckey'
])

export const isMisskeyDomain = async (domain: string): Promise<boolean> => {
  const software = await getServerSoftware(domain)
  return software ? MISSKEY_FAMILY_SOFTWARE.has(software) : false
}

export const isMisskeyActor = async (person: Actor): Promise<boolean> => {
  try {
    const actorUrl = new URL(person.id)
    return isMisskeyDomain(actorUrl.host)
  } catch {
    return false
  }
}

const MEDIA_ONLY_SOFTWARE = new Set(['pixelfed', 'peertube'])

export const isMediaOnlyDomain = async (domain: string): Promise<boolean> => {
  const software = await getServerSoftware(domain)
  return software ? MEDIA_ONLY_SOFTWARE.has(software) : false
}

export const isMediaOnlyActor = async (person: Actor): Promise<boolean> => {
  try {
    const actorUrl = new URL(person.id)
    return isMediaOnlyDomain(actorUrl.host)
  } catch {
    return false
  }
}
