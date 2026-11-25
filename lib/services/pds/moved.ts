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
 * When a hosted repo's stored PLC operation points `services.atproto_pds.endpoint`
 * at an origin other than this server's configured PDS host for its domain,
 * returns the destination host (e.g. `bsky.social` or `pds.example:8443`).
 * Returns `null` when the account is still hosted here or cannot be compared.
 */
export const getMovedToHost = (repo: {
  domain: string
  plcOperation: string | null
}): string | null => {
  const endpoint = getPlcOperationPdsEndpoint(repo.plcOperation)
  if (!endpoint) return null
  const localHostname = getPdsConfig()?.[repo.domain]?.hostname
  if (!localHostname) return null
  let localOrigin: string
  try {
    localOrigin = new URL(`https://${localHostname}`).origin
  } catch {
    return null
  }
  return endpoint.origin !== localOrigin ? endpoint.host : null
}

/**
 * Whether a stored PLC operation's `services.atproto_pds.endpoint` already
 * points at `pdsUrl` (an https origin).
 */
export const isPlcOperationPointingTo = (
  plcOperation: string | null,
  pdsUrl: string
): boolean => {
  const endpoint = getPlcOperationPdsEndpoint(plcOperation)
  if (!endpoint) return false
  try {
    return endpoint.origin === new URL(pdsUrl).origin
  } catch {
    return false
  }
}
