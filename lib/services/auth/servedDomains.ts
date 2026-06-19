type ServedDomainsConfig = {
  host: string
  trustedHosts?: readonly string[] | null
}

export type ServedDomain = {
  domain: string
  primary: boolean
}

// Reduce a configured host/trusted-host entry to a bare hostname (no scheme,
// port, or trailing dot). Wildcard (`*.example.com`) and unparseable entries
// return null — a passkey is bound to one concrete domain, so a wildcard can't
// be a chooser option.
const toHostname = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('*')) return null
  try {
    const url = new URL(
      trimmed.includes('://') ? trimmed : `https://${trimmed}`
    )
    return url.hostname.replace(/\.$/, '') || null
  } catch {
    return null
  }
}

// The user-facing domains this instance serves, derived from ACTIVITIES_HOST
// (the primary / home domain) and ACTIVITIES_TRUSTED_HOSTS. A WebAuthn passkey
// is bound to exactly one domain, so the add-passkey dialog offers this list and
// each passkey row is labelled with its domain. The primary is always first and
// never duplicated.
export const getServedDomains = (
  config: ServedDomainsConfig
): ServedDomain[] => {
  const result: ServedDomain[] = []
  const seen = new Set<string>()

  const primary = toHostname(config.host)
  if (primary) {
    result.push({ domain: primary, primary: true })
    seen.add(primary)
  }

  for (const raw of config.trustedHosts ?? []) {
    const hostname = toHostname(raw)
    if (!hostname || seen.has(hostname)) continue
    seen.add(hostname)
    result.push({ domain: hostname, primary: false })
  }

  return result
}
