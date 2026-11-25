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
 * Without the domain's PDS config this server's own origin is unknown, so the
 * endpoint alone can't tell: the move's switch is then recognised by the
 * handle it clears, and a live account (which keeps its handle) is not.
 */
export const getMovedToHost = (repo: {
  domain: string
  handle: string | null
  plcOperation: string | null
}): string | null => {
  const endpoint = getPlcOperationPdsEndpoint(repo.plcOperation)
  if (!endpoint) return null
  const localOrigin = getLocalPdsOrigin(repo.domain)
  if (!localOrigin) return repo.handle === null ? endpoint.host : null
  return endpoint.origin !== localOrigin ? endpoint.host : null
}

/**
 * Whether a PLC operation (from the directory, or just signed) points
 * `services.atproto_pds.endpoint` away from this server for `domain`: an https
 * endpoint that is not this server's PDS origin. For a repo's stored operation
 * use `getMovedToHost`. A domain with no PDS config counts as away, so callers
 * without the config (cancel) compare endpoints themselves.
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
