import { getBrandAssetSrc } from '@/lib/utils/getBrandAssetSrc'

/**
 * The brand mark for an auth card. See `getBrandAssetSrc`: an absolute URL on
 * the configured host (ACTIVITIES_HOST) so it resolves against the canonical
 * origin instead of the request host (a root-relative `/logo-nav.png` can be
 * redirected away behind a CDN alias domain), or root-relative in `next dev`.
 */
export const getAuthLogoSrc = (): string => getBrandAssetSrc('/logo-nav.png')
