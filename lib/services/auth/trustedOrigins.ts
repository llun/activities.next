import { logger } from '@/lib/utils/logger'

// Build the better-auth `trustedOrigins` list. better-auth only accepts
// state-changing auth requests (e.g. credential sign-in) whose Origin matches a
// trusted origin; by default that is only the configured base URL. When the
// deployment serves additional local domains (ACTIVITIES_TRUSTED_HOSTS) — e.g.
// a custom domain a Mastodon client logs into directly — those origins must be
// trusted too, otherwise sign-in returns `403 Invalid origin`.
export const buildTrustedOrigins = (
  baseURL: string,
  trustedHosts: readonly string[] = []
): string[] => {
  const base = new URL(baseURL)
  const origins = [base.origin]

  for (const raw of trustedHosts) {
    const host = raw.trim()
    if (!host) continue
    try {
      const url = new URL(
        host.includes('://') ? host : `${base.protocol}//${host}`
      )
      // better-auth routes any pattern containing `*` through `wildcardMatch`,
      // so a misplaced wildcard is a GLOB rather than an inert literal:
      // `*example.com` trusts `evilexample.com`, and `isTrustedOrigin` gates
      // the Origin check on state-changing auth requests as well as
      // `callbackURL`/`redirectTo` — an open redirect carrying auth callbacks.
      // Only the documented `*.example.com` spelling is a wildcard.
      //
      // Checked on the PARSED hostname, because the parser is what MAKES the
      // `*`: it percent-decodes the authority, applies IDNA mapping and strips
      // tab/CR/LF, so `%2aexample.com` and a fullwidth `＊example.com` both
      // reach this line already spelled with one. A pre-parse check misses
      // every such form without even buying a first line of defence — a
      // literal `*example.com` parses to a hostname carrying the same `*`.
      // The guard reads `hostname` but what gets pushed is `origin`, so the
      // two have to describe the same authority. For every web scheme they do
      // — but `blob:` derives its origin from the inner URL in its PATH and
      // reports an empty host, so `blob:https://*evil.com/x` hides the
      // wildcard from `hostname` and smuggles it into `origin`. Requiring a
      // web scheme is what keeps the check looking at the value it guards; it
      // also drops the inert literal `"null"` origins that `foo://…` and
      // `file:///…` would otherwise contribute.
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        logger.warn({
          message: `Ignoring non-web ACTIVITIES_TRUSTED_HOSTS entry: ${raw}`
        })
        continue
      }
      if (url.hostname.replace(/^\*\./, '').includes('*')) {
        logger.warn({
          message: `Ignoring misplaced wildcard in ACTIVITIES_TRUSTED_HOSTS entry: ${raw}`
        })
        continue
      }
      origins.push(url.origin)
    } catch {
      // Skip the bad entry rather than crash auth init, but log it so a
      // misconfigured ACTIVITIES_TRUSTED_HOSTS value isn't an invisible 403.
      logger.warn({
        message: `Ignoring invalid ACTIVITIES_TRUSTED_HOSTS entry: ${raw}`
      })
    }
  }

  return Array.from(new Set(origins))
}
