import { Metadata } from 'next'

import { buildHeatmapEmbedImageUrl } from '@/lib/fitness/heatmapEmbedImageUrl'

import { SharedHeatmapView } from './sharedHeatmapView'

/**
 * Card image size, in the dimensions the image route will actually serve.
 *
 * 1200x600 rather than the 1200x630 the OpenGraph guidance suggests, because
 * that route snaps each axis to its DIMENSION_STEP of 100: asking for 630
 * yields 600 bytes-wise, and a declared height that disagrees with the image is
 * worse than a slightly taller aspect ratio. Both are comfortably over the
 * large-card thresholds (X wants 300x157, Facebook 600x315).
 *
 * The Apple snapshot path is the one renderer whose output differs — it fits
 * into Apple's 640px ceiling and doubles the density, so those bytes are
 * 1280x640. Same 2:1 ratio, and consumers treat these as hints, so the declared
 * pair stays the size that was requested.
 */
export const HEATMAP_CARD_IMAGE_WIDTH = 1200
export const HEATMAP_CARD_IMAGE_HEIGHT = 600

/**
 * What a token that resolves to nothing publishable gets: the generic title and
 * the same noindex, and no card at all.
 *
 * A revoked share, one re-queued for generation, and one whose region cannot be
 * resolved all render as a 404 — so describing them in OpenGraph would publish
 * the region name, the owner's handle and a thumbnail for a page that refuses
 * to serve any of it.
 */
export const UNRESOLVED_SHARE_METADATA: Metadata = {
  title: 'Route heatmap',
  robots: { index: false, follow: false }
}

interface BuildSharedHeatmapMetadataParams {
  view: SharedHeatmapView
  /** Instance display name, for `og:site_name`. */
  siteName: string
  /** Canonical origin for the card's image URL (the actor's own domain). */
  origin: string
  shareToken: string
}

/**
 * Builds the link-preview card for a public shared heatmap.
 *
 * Everything here is already on the page itself — the heading, the owner line,
 * the generated date and the map — so the card publishes nothing the token does
 * not already hand over. Pure, so it can be unit tested without rendering the
 * async server page.
 */
export const buildSharedHeatmapMetadata = ({
  view,
  siteName,
  origin,
  shareToken
}: BuildSharedHeatmapMetadataParams): Metadata => {
  // Same phrasing as the share dialog's alt text, so a heatmap reads alike
  // wherever it is linked.
  const title = `Route heatmap — ${view.title}`
  // Owner and date only. The page's bbox caption is deliberately left out: as a
  // card subtitle "TL 52.50°N 4.80°E → BR 52.30°N 5.00°E" reads as debug output,
  // and the map itself locates the share better than its corners do.
  const description = `${view.owner.name} (${view.owner.handle}) · Generated ${view.generatedLabel}`
  const images = [
    {
      // `format=png` is what makes this usable: the image route answers SVG
      // wherever it falls through to the keyless renderer, and no card crawler
      // renders SVG — the tag would be well formed and show no image.
      url: buildHeatmapEmbedImageUrl({
        origin,
        shareToken,
        width: HEATMAP_CARD_IMAGE_WIDTH,
        height: HEATMAP_CARD_IMAGE_HEIGHT,
        format: 'png'
      }),
      width: HEATMAP_CARD_IMAGE_WIDTH,
      height: HEATMAP_CARD_IMAGE_HEIGHT,
      alt: title
    }
  ]

  return {
    title,
    description,
    // A capability URL (the token is the secret), so it stays out of search
    // indexes. That costs the card nothing: crawlers read OpenGraph without
    // consulting this — including this instance's own parser, which never looks
    // at it — and a heatmap indexed by Google is the one outcome sharing a
    // token is not meant to produce.
    robots: { index: false, follow: false },
    openGraph: {
      type: 'website',
      title,
      description,
      // An operator can blank the instance name; an empty og:site_name is worse
      // than none, so drop the tag rather than emit it empty.
      siteName: siteName.trim() || undefined,
      url: view.publicUrl,
      images
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images
    }
  }
}
