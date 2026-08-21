/**
 * Query shape of `GET /embed/heatmap/<token>/image`.
 *
 * Deliberately dependency-free: the share dialog builds this URL in the
 * browser and the share page's link-preview card builds it on the server, and
 * a route contract with two implementations is one that eventually disagrees
 * with itself. This repo has already paid for that once — two tile-query
 * parsers drifted until `?z=4&z=16` resolved differently on each route.
 */
export interface HeatmapEmbedImageUrlParams {
  /** Origin to build against. Any trailing slash is dropped. */
  origin: string
  shareToken: string
  width: number
  height: number
  /**
   * Ask for raster bytes. Omit for the route's default, which answers SVG
   * wherever it falls through to the keyless renderer — fine in an `<img>`,
   * useless as an `og:image`, since no card crawler renders SVG.
   */
  format?: 'png'
}

export const buildHeatmapEmbedImageUrl = ({
  origin,
  shareToken,
  width,
  height,
  format
}: HeatmapEmbedImageUrlParams): string => {
  // Drop any trailing slash so a base like `https://host/` can't yield `//`.
  const base = origin.replace(/\/+$/, '')
  const query = `w=${width}&h=${height}${format ? `&format=${format}` : ''}`
  return `${base}/embed/heatmap/${shareToken}/image?${query}`
}
