// Design tokens for the transactional/notification email skeleton.
//
// Email has no stylesheet and no CSS variables — every value has to be inlined
// literally at the point of use, so these constants are the only place a colour
// or size is written down. They mirror `app/globals.css` but are NOT derived
// from it: the app's tokens are `hsl()`/`oklch()` and Outlook only understands
// hex, so the values are pinned as the design system spells them.
//
// Note `BUTTON_BACKGROUND` is the design's `#E66A0F`, which is very slightly
// warmer than the app's `--primary` `hsl(24 95% 46%)` (`#E55F06`). The design
// is the reviewed source of truth for email, so the literal wins here.

export const FONT_STACK =
  "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/** Outer canvas the 600px column floats on. */
export const PAGE_BACKGROUND = '#f4f4f4'
/** The single card holding the message body. */
export const CARD_BACKGROUND = '#fdfdfd'

export const BORDER = '#e5e5e5'
/** Lighter rule used only for the in-card "if you didn't request this" divider. */
export const BORDER_SUBTLE = '#ececec'

/** Headings and stat values. */
export const TEXT = '#0a0a0a'
/** Wordmark and quoted display names — a touch lighter than a heading. */
export const TEXT_STRONG = '#191919'
/** Body copy. */
export const TEXT_BODY = '#404040'
/** In-card secondary copy: labels, fallback URLs, expiry notes. */
export const TEXT_MUTED = '#737373'
/** Chrome outside the card: host, handles, footer. */
export const TEXT_CHROME = '#8a8a8a'

export const BUTTON_BACKGROUND = '#E66A0F'
export const BUTTON_TEXT = '#ffffff'

export const CONTENT_WIDTH = 600

export const RADIUS_CARD = '12px'
export const RADIUS_BUTTON = '6px'
export const RADIUS_FULL = '9999px'
