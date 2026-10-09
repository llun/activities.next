import { getBaseURL } from '@/lib/config'

/**
 * The brand mark for an auth card, as an absolute URL on the configured host
 * (ACTIVITIES_HOST) so it resolves against the canonical origin instead of the
 * request host. When the instance is served behind a CDN on an alias domain, a
 * root-relative `/logo-nav.png` can be intercepted and redirected away from the
 * app origin.
 */
export const getAuthLogoSrc = (): string =>
  new URL('/logo-nav.png', getBaseURL()).toString()
