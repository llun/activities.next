/**
 * The one frame every list of posts sits in: the surface kit's flat
 * `rounded-lg border bg-background`, with no shadow, and `divide-y` hairlines
 * between the rows (set by the feed itself). Home, bookmarks, favorites, tags,
 * lists, profile tabs, status replies, explore and search all draw their posts
 * with `Posts` / `TimelineFeed`, which wear it, and their loading skeletons
 * wear it too so nothing jumps when the posts arrive.
 */
export const POST_LIST_FRAME_CLASS = 'rounded-lg border bg-background'

/**
 * Below `md` a feed region owns the full phone width: it spans the viewport,
 * cancels the enclosing shell's horizontal padding (whatever it is), and drops
 * its outer border and corner rounding, while keeping its separators, internal
 * padding, and the borders of nested controls and cards. Above `md` the desktop
 * frame is untouched.
 *
 * Apply this, with `POST_LIST_FRAME_CLASS`, to the element that owns a feed
 * region's outer frame: the feed itself, its loading skeleton and the home
 * composer.
 *
 * The margin is viewport-relative on purpose. The shared `/` loading boundary
 * renders under two different shells — the signed-in content column (`px-4`)
 * and the raw logged-out landing branch with no padding at all — so a fixed
 * `-mx-4` overflowed the viewport by 16px on each side in the second one.
 * `calc(50% - 50vw)` expands the box to the viewport symmetrically from
 * whichever centered column holds it, and resolves to `0` in an unpadded
 * shell. `w-auto` is load-bearing: with `width: 100%` the negative margins
 * only shift a `w-full` frame left instead of widening it. (`vw` includes a
 * classic scrollbar, so a narrow non-overlay-scrollbar window can overshoot by
 * half its width in the one branch with no clipping ancestor — the raw
 * logged-out loading shell; overlay-scrollbar viewports land exactly.)
 */
export const MOBILE_FEED_SURFACE_CLASS =
  'max-md:mx-[calc(50%_-_50vw)] max-md:w-auto max-md:rounded-none max-md:border-0'

/**
 * The logged-out status page is the one place below `md` where the thread is
 * not full-bleed: its post, its replies and the "Join the conversation" block
 * are separate inset frames, level with the cards of `PublicFooter`, instead of
 * one frame spanning the viewport. Every class is `max-md:`-scoped, so from
 * `md` up the single desktop frame is untouched.
 *
 * The page's outer frame takes `MOBILE_INSET_STACK_CLASS` in place of
 * `MOBILE_FEED_SURFACE_CLASS`: it stops painting a frame of its own and stacks
 * the cards 24px apart, the same 24px `PublicShell`'s `py-6` leaves between the
 * top bar and the first card (so the page no longer pulls itself up under the
 * bar with a negative margin). Each card then takes
 * `MOBILE_INSET_CARD_FRAME_CLASS`; a card that has no background of its own
 * adds the background through `MOBILE_INSET_CARD_CLASS`.
 */
export const MOBILE_INSET_STACK_CLASS =
  'max-md:flex max-md:flex-col max-md:gap-6 max-md:rounded-none max-md:border-0 max-md:bg-transparent'

export const MOBILE_INSET_CARD_FRAME_CLASS = 'max-md:rounded-lg max-md:border'

export const MOBILE_INSET_CARD_CLASS = `${MOBILE_INSET_CARD_FRAME_CLASS} max-md:bg-background`

/**
 * A `Posts` feed that is one more inset card below `md`, for a logged-out
 * page whose other blocks are inset cards (the shared collection). `Posts`
 * frames itself with `MOBILE_FEED_SURFACE_CLASS`; pass this as its `className`,
 * which is merged after it, so each token takes back what the surface dropped:
 * `max-md:mx-0` the viewport-wide margin (`w-auto` stays and fills the column),
 * the card frame the rounding, border and shadow. The rows and their media rows
 * then end at the card's inner edge, in the page's own 16px column.
 */
export const MOBILE_INSET_FEED_CLASS = `max-md:mx-0 ${MOBILE_INSET_CARD_FRAME_CLASS}`
