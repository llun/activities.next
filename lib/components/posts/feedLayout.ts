/**
 * Below `md` a feed region owns the full phone width: it spans the viewport,
 * cancels the enclosing shell's horizontal padding (whatever it is), and drops
 * its outer border, shadow and corner rounding, while keeping its separators,
 * internal padding, and the borders of nested controls and cards. Above `md`
 * the desktop frame is untouched.
 *
 * Apply this to the element that owns a feed region's outer frame: the feed
 * itself, its loading skeleton, its empty state, and the home composer.
 *
 * The margin is viewport-relative on purpose. The shared `/` loading boundary
 * renders under two different shells — the signed-in content column (`px-4`)
 * and the raw logged-out landing branch with no padding at all — so a fixed
 * `-mx-4` overflowed the viewport by 16px on each side in the second one.
 * `calc(50% - 50vw)` expands the box to the viewport symmetrically from
 * whichever centered column holds it, and resolves to `0` in an unpadded
 * shell. `w-auto` is load-bearing: with `width: 100%` the negative margins
 * only shift a `w-full` frame left instead of widening it.
 */
export const MOBILE_FEED_SURFACE_CLASS =
  'max-md:mx-[calc(50%_-_50vw)] max-md:w-auto max-md:rounded-none max-md:border-0 max-md:shadow-none'
