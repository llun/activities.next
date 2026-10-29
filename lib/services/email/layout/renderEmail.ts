import { getBaseURL } from '@/lib/config'
import {
  type EmailBrand,
  brandBaseURL,
  brandHost
} from '@/lib/services/email/brand'
import { RenderedEmail } from '@/lib/services/email/types'
import { escapeHtml } from '@/lib/utils/text/escapeHtml'

import { EmailBlock } from './blocks'
import {
  BORDER,
  CARD_BACKGROUND,
  CONTENT_WIDTH,
  FONT_STACK,
  PAGE_BACKGROUND,
  RADIUS_CARD,
  TEXT_CHROME,
  TEXT_STRONG
} from './theme'

export type EmailFooter =
  /**
   * Social events, which the recipient can switch off per type. Names the event
   * and links to the settings page that controls it.
   */
  | { kind: 'notification'; eventLabel: string; handle: string }
  /**
   * Account and security mail, which always sends. There is no toggle to link,
   * so it explains itself by naming the address it was sent to.
   */
  | { kind: 'account'; recipientEmail: string }

export interface RenderEmailOptions {
  /** Used as the message subject and as the document `<title>`. */
  subject: string
  /** One-line summary shown in the inbox preview strip, hidden in the body. */
  preheader: string
  blocks: readonly EmailBlock[]
  footer: EmailFooter
  /**
   * The visited or recipient domain's name and host. The wordmark shows its
   * name; the header host and every link use its domain. The header logo is
   * the one exception: it always comes from the configured host, because an
   * alias domain may redirect elsewhere and not serve the public/ assets.
   * Omitted, the email reads as the primary host's, with the wordmark
   * "Activities".
   */
  brand?: EmailBrand
}

// Padding for the inbox preview strip. Without enough of it a client backfills
// the snippet with whatever body copy comes next — here the wordmark and host,
// so the preview would read "…account on example.com. Activities example.com
// Verify your email…". Gmail's list snippet runs to ~100 characters and
// Outlook.com's to ~120, and the longest preheader below is 89, so the padding
// has to cover the remainder rather than just trail it.
const PREHEADER_PADDING = '&zwnj;&nbsp;'.repeat(30)

const footerLinkStyle = `color:${TEXT_CHROME};text-decoration:underline;`

const renderHeader = (host: string, name: string): string => {
  // The logo always comes from the configured host (getBaseURL()), never the
  // brand domain: an alias domain may redirect elsewhere and not serve the
  // public/ assets — a real llun.dev email pointed at
  // https://llun.dev/logo-nav.png, which 302-redirects to www.llun.me (another
  // site, no file) and rendered blank, while the primary host serves the file.
  // This is the same reason the web UI loads brand assets through
  // getBrandAssetSrc. Absolute, because a root-relative src is unresolvable in
  // a mail client; getBaseURL() keeps it correct on http/custom-port
  // deployments and on instances whose host already carries a scheme.
  const logoUrl = new URL('/logo-nav.png', getBaseURL()).toString()
  return (
    // Auto layout: a wordmark and host keep their natural widths, so the 20px
    // wordmark never wraps (fixed layout squeezed it onto two lines at a 320px
    // viewport). The wordmark and host cells still carry overflow-wrap:anywhere,
    // which lowers their min-content width, so a very long custom host can
    // still make the header shrink instead of overflowing.
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%"><tr>` +
    // Explicit dimensions and display:block keep the three-column header intact
    // when the client blocks remote images, which most do by default. The
    // wordmark beside it is real text, so the header still reads without it.
    // alt is empty on purpose: the wordmark beside it says the name in real
    // text, so alt text here would make a client with images off read
    // "Activities Activities example.com".
    `<td width="28" style="width:28px;"><img src="${escapeHtml(logoUrl)}" width="28" height="28" alt="" style="display:block;width:28px;height:28px;border-radius:6px;border:0;"></td>` +
    `<td style="padding-left:8px;font-family:${FONT_STACK};font-size:20px;font-weight:600;letter-spacing:-0.01em;color:${TEXT_STRONG};word-wrap:break-word;overflow-wrap:anywhere;">${escapeHtml(name)}</td>` +
    `<td align="right" style="font-family:${FONT_STACK};font-size:13px;color:${TEXT_CHROME};word-wrap:break-word;overflow-wrap:anywhere;">${escapeHtml(host)}</td>` +
    `</tr></table>`
  )
}

const renderFooterHtml = (
  footer: EmailFooter,
  baseUrl: string,
  host: string
): string => {
  const homeLink = `<a href="${escapeHtml(baseUrl)}" style="${footerLinkStyle}">${escapeHtml(host)}</a>`
  if (footer.kind === 'account') {
    return (
      `This email was sent to ${escapeHtml(footer.recipientEmail)} because of account activity on ${escapeHtml(host)}.` +
      `<br>${homeLink}`
    )
  }
  const settingsUrl = new URL('/settings/notifications', baseUrl).toString()
  return (
    `You're receiving this because email notifications for ${escapeHtml(footer.eventLabel)} are turned on for ${escapeHtml(footer.handle)}.` +
    `<br><a href="${escapeHtml(settingsUrl)}" style="${footerLinkStyle}">Manage email notifications</a>` +
    ` &nbsp;&middot;&nbsp; ${homeLink}`
  )
}

const renderFooterText = (
  footer: EmailFooter,
  baseUrl: string,
  host: string
): string => {
  if (footer.kind === 'account') {
    return `This email was sent to ${footer.recipientEmail} because of account activity on ${host}.`
  }
  const settingsUrl = new URL('/settings/notifications', baseUrl).toString()
  return (
    `You're receiving this because email notifications for ${footer.eventLabel} are turned on for ${footer.handle}.\n` +
    `Manage email notifications: ${settingsUrl}`
  )
}

/**
 * Wrap a template's blocks in the shared skeleton and produce both media.
 *
 * The document is deliberately old-fashioned — nested tables, every style
 * inline, no classes, no stylesheet — because that is the only markup mail
 * clients agree on. The single `<style>` block is an MSO conditional that swaps
 * the font stack for Arial in Outlook's Word rendering engine.
 */
export const renderEmail = ({
  subject,
  preheader,
  blocks,
  footer,
  brand
}: RenderEmailOptions): RenderedEmail => {
  const host = brandHost(brand)
  const baseUrl = brandBaseURL(brand)
  const name = brand?.name || 'Activities'

  const body = blocks.map((block) => block.html).join('')
  const html =
    `<!doctype html>\n<html lang="en">\n<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">\n` +
    `<meta name="color-scheme" content="light dark">\n` +
    `<meta name="supported-color-schemes" content="light dark">\n` +
    // Apple Mail and iOS Mail data detectors would otherwise auto-link the
    // recipient address in the footer and the "expires in 24 hours" note,
    // rendering them as blue underlined links inside muted grey copy.
    `<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">\n` +
    `<meta name="x-apple-disable-message-reformatting">\n` +
    `<title>${escapeHtml(subject)}</title>\n` +
    // h1 has to be in this list too — without it Outlook's Word engine leaves
    // the headline on the inline stack (resolving to Segoe UI) while every
    // other element becomes Arial, so each email mixes two typefaces.
    `<!--[if mso]><style>table,td,a,p,div,h1,strong{font-family:Arial,Helvetica,sans-serif !important;}</style><![endif]-->\n` +
    `</head>\n` +
    `<body style="margin:0;padding:0;background-color:${PAGE_BACKGROUND};" bgcolor="${PAGE_BACKGROUND}">\n` +
    // mso-hide:all is required on top of display:none — Outlook honours only
    // the former and would otherwise print the preheader above the header.
    `<span style="display:none;font-size:1px;color:${PAGE_BACKGROUND};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}${PREHEADER_PADDING}</span>\n` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE_BACKGROUND}" style="background-color:${PAGE_BACKGROUND};">\n` +
    `<tr><td align="center" style="padding:32px 16px;">\n` +
    // width:100% (not a fixed 600px) is what lets the column shrink on a phone:
    // a rigid width combined with the width=device-width meta above is the
    // classic mobile-overflow bug, because that meta is exactly what suppresses
    // iOS Mail's shrink-to-fit. table-layout:fixed keeps a long unbreakable URL
    // from stretching it.
    //
    // Outlook's Word engine does not support max-width, so on its own the
    // width:100% would let the card fill the whole reading pane there. The MSO
    // ghost table below pins it to 600px for Outlook only — every other client
    // sees a comment. Relying on the width ATTRIBUTE to beat the inline style
    // instead would be a guess: in standards engines the style wins, which is
    // precisely why the column can shrink at all.
    `<!--[if mso]><table role="presentation" width="${CONTENT_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${CONTENT_WIDTH}px;"><tr><td><![endif]-->\n` +
    `<table role="presentation" width="${CONTENT_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${CONTENT_WIDTH}px;table-layout:fixed;">\n` +
    `<tr><td style="padding:0 8px 16px;">${renderHeader(host, name)}</td></tr>\n` +
    `<tr><td bgcolor="${CARD_BACKGROUND}" style="background-color:${CARD_BACKGROUND};border:1px solid ${BORDER};border-radius:${RADIUS_CARD};padding:28px 28px 26px;">${body}</td></tr>\n` +
    `<tr><td style="padding:20px 8px 0;font-family:${FONT_STACK};font-size:12px;line-height:1.7;color:${TEXT_CHROME};">${renderFooterHtml(footer, baseUrl, host)}</td></tr>\n` +
    `</table>\n` +
    `<!--[if mso]></td></tr></table><![endif]-->\n` +
    `</td></tr>\n</table>\n</body>\n</html>\n`

  const text = [
    ...blocks.map((block) => block.text).filter(Boolean),
    renderFooterText(footer, baseUrl, host)
  ].join('\n\n')

  return { subject, text, html }
}
