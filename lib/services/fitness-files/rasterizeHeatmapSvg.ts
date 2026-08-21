import sharp from 'sharp'

/**
 * Rasterizes a heatmap SVG to PNG bytes.
 *
 * The keyless renderer answers with SVG, which a browser draws happily but a
 * link-preview crawler (X, Facebook, Mastodon, Slack, Discord) refuses — an
 * `og:image` pointing at one yields a card with no image at all. Callers that
 * need a raster ask for one, and this is the conversion.
 *
 * `buildHeatmapSvg` emits nothing but numbers and a fixed colour: no text
 * nodes, no external references, no embedded assets. That matters because the
 * production image is bare `node:24-alpine` with no fonts installed and no
 * outbound access from the rasterizer — an SVG carrying either would render
 * blank there while looking correct in development.
 */
export const rasterizeHeatmapSvg = async (svg: string) => {
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  // Copied out of the Buffer sharp returns, which may be pooled — and a
  // `Buffer` is not a `BodyInit`, so a Response wants the plain view anyway.
  // The return type is left to inference: annotating it `Uint8Array` widens the
  // buffer parameter to `ArrayBufferLike`, which `BodyInit` does not accept.
  // Same conversion the Apple snapshot path makes.
  return new Uint8Array(png)
}
