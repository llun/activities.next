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
    // Parsing via `new URL(...).origin` normalizes the value (strips any path or
    // trailing slash). Skip malformed entries so a bad config value can't crash
    // auth initialization.
    try {
      const origin = new URL(
        host.includes('://') ? host : `${base.protocol}//${host}`
      ).origin
      origins.push(origin)
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
