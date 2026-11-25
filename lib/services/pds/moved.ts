import { getPdsConfig } from '@/lib/config/blueskyPds'

/**
 * Parses `services.atproto_pds.endpoint` from a stored `did:plc` operation
 * JSON string, returning its URL when it is a valid `https:` URL, or null.
 *
 * Free of `@atproto/*` so CommonJS callers (database layer, actor deletion,
 * account events) can import it safely.
 */
export const getPlcOperationPdsEndpoint = (
  plcOperation: string | null
): URL | null => {
  if (!plcOperation) return null
  try {
    const parsed = JSON.parse(plcOperation) as {
      services?: { atproto_pds?: { endpoint?: unknown } }
    }
    const endpoint = parsed?.services?.atproto_pds?.endpoint
    if (typeof endpoint !== 'string' || !endpoint) return null
    const url = new URL(endpoint)
    if (url.protocol !== 'https:') return null
    return url
  } catch {
    return null
  }
}

/**
 * This server's PDS origin for `domain`, or null when the domain has no PDS
 * config (or its hostname is not a usable URL).
 */
const getLocalPdsOrigin = (domain: string): string | null => {
  const hostname = getPdsConfig()?.[domain]?.hostname
  if (!hostname) return null
  try {
    return new URL(`https://${hostname}`).origin
  } catch {
    return null
  }
}

/**
 * When a hosted repo's stored PLC operation points `services.atproto_pds.endpoint`
 * at an origin other than this server's configured PDS host for its domain,
 * returns the destination host (e.g. `bsky.social` or `pds.example:8443`).
 * Returns `null` when the account is still hosted here or has no https
 * endpoint.
 *
 * A domain with no PDS config is treated as moved for any https endpoint: the
 * operator removed the PDS, so the copy here is inert either way. Failing
 * closed keeps a moved copy deletable and relinkable instead of looking live.
 */
export const getMovedToHost = (repo: {
  domain: string
  plcOperation: string | null
}): string | null => {
  const endpoint = getPlcOperationPdsEndpoint(repo.plcOperation)
  if (!endpoint) return null
  const localOrigin = getLocalPdsOrigin(repo.domain)
  if (!localOrigin) return endpoint.host
  return endpoint.origin !== localOrigin ? endpoint.host : null
}

/**
 * Whether a stored PLC operation's `services.atproto_pds.endpoint` points away
 * from this server for `domain`: an https endpoint that is not this server's
 * PDS origin. A domain with no PDS config counts as away for any https
 * endpoint, the same fail-closed rule as `getMovedToHost`.
 */
export const isPlcOperationPointingAway = (
  plcOperation: string | null,
  domain: string
): boolean => {
  const endpoint = getPlcOperationPdsEndpoint(plcOperation)
  if (!endpoint) return false
  const localOrigin = getLocalPdsOrigin(domain)
  if (!localOrigin) return true
  return endpoint.origin !== localOrigin
}
