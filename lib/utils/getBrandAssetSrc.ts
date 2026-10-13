import { getBaseURL } from '@/lib/config'

/**
 * The `src` for a brand asset served from `public/` (for example
 * `/logo-nav.png`).
 *
 * Normally an absolute URL on the configured host (ACTIVITIES_HOST) so it
 * resolves against the canonical origin instead of the request host. When the
 * instance is served behind a CDN on an alias domain, a root-relative path can
 * be intercepted and redirected away from the app origin.
 *
 * In `next dev` the root-relative path is returned unchanged. Developers often
 * browse at http://localhost:3000 while ACTIVITIES_HOST names another host (a
 * local alias, a tunnel or production); the absolute URL would then point at a
 * host that does not serve the asset and that CSP `img-src` blocks, so the
 * image would be missing.
 */
export const getBrandAssetSrc = (path: string): string =>
  process.env.NODE_ENV === 'development'
    ? path
    : new URL(path, getBaseURL()).toString()
