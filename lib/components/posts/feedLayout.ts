/**
 * Below `md` a feed region owns the full phone width: it cancels the page
 * column's `px-4` gutter and drops its outer border, shadow and corner
 * rounding, while keeping its separators, internal padding, and the borders of
 * nested controls and cards. Above `md` the desktop frame is untouched.
 *
 * Apply this to the element that owns a feed region's outer frame: the feed
 * itself, its loading skeleton, its empty state, and the home composer. The
 * enclosing column must inset the region by exactly 16px (`px-4`), or the
 * negative margin bleeds past the viewport and creates horizontal overflow.
 *
 * `w-auto` is load-bearing, not tidiness: on an element that already carries
 * `w-full` (the `Posts` section), `width: 100%` pins the box to the column's
 * content width and the negative margins only shift it left, leaving a 16px
 * gap on the right. `width: auto` lets both margins grow the box instead.
 */
export const MOBILE_FEED_SURFACE_CLASS =
  'max-md:-mx-4 max-md:w-auto max-md:rounded-none max-md:border-0 max-md:shadow-none'

/**
 * {@link MOBILE_FEED_SURFACE_CLASS} for a frame inside a container whose
 * horizontal padding is `p-4` and grows to `p-5` at `sm` — the fitness status
 * detail body. The negative margin tracks the container padding at each step
 * and resets to zero from `md` up. The frame tokens are `max-md:`-scoped like
 * the base constant, so desktop keeps the border, rounding and shadow.
 */
export const MOBILE_FEED_SURFACE_SM_P5_CLASS =
  '-mx-4 max-md:w-auto max-md:rounded-none max-md:border-0 max-md:shadow-none sm:-mx-5 md:mx-0'
