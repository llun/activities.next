import { escapeHtml } from '@/lib/utils/text/escapeHtml'

import { QuoteAuthor, getInitials, getMonogramColor } from './actorDisplay'
import {
  BORDER,
  BORDER_SUBTLE,
  BUTTON_BACKGROUND,
  BUTTON_TEXT,
  FONT_STACK,
  INSET_BACKGROUND,
  RADIUS_BUTTON,
  RADIUS_FULL,
  RADIUS_INSET,
  TEXT,
  TEXT_BODY,
  TEXT_CHROME,
  TEXT_MUTED,
  TEXT_STRONG
} from './theme'

/**
 * One row of an email card. Every builder produces BOTH media at once, so a
 * block can never exist in the HTML part and be missing from the plain-text
 * part — which is how the two halves used to drift apart.
 *
 * `text` may be empty for a block that adds nothing to the text alternative
 * (the fallback-URL paragraph, whose URL the button line already carried).
 */
export interface EmailBlock {
  readonly html: string
  readonly text: string
}

/** A run inside a paragraph: plain text, a link, or a bolded fragment. */
export type Inline =
  | string
  | { readonly label: string; readonly href: string }
  | { readonly strong: string }

export type InlineContent = string | readonly Inline[]

const EMPTY_BLOCK: EmailBlock = { html: '', text: '' }

// `mailto:` is allowed alongside http(s) because the actor-deleted notice links
// the instance contact address. Everything else — `javascript:`, `data:`, and
// any relative path, which no mail client can resolve — is refused. Remote
// actors control `status.url`, so this is a live vector, not a formality.
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

const safeUrl = (url: string): string | null => {
  try {
    return SAFE_PROTOCOLS.has(new URL(url).protocol) ? url : null
  } catch {
    return null
  }
}

const toInlines = (content: InlineContent): readonly Inline[] =>
  typeof content === 'string' ? [content] : content

const renderInlineHtml = (content: InlineContent): string =>
  toInlines(content)
    .map((part) => {
      if (typeof part === 'string') return escapeHtml(part)
      if ('strong' in part) {
        return `<strong style="font-weight:600;color:${TEXT};">${escapeHtml(part.strong)}</strong>`
      }
      const href = safeUrl(part.href)
      // An unusable href degrades to plain text rather than a dead or dangerous
      // link — the sentence still reads correctly without it.
      if (!href) return escapeHtml(part.label)
      return `<a href="${escapeHtml(href)}" style="color:${TEXT_MUTED};text-decoration:underline;">${escapeHtml(part.label)}</a>`
    })
    .join('')

const renderInlineText = (content: InlineContent): string =>
  toInlines(content)
    .map((part) => {
      if (typeof part === 'string') return part
      if ('strong' in part) return part.strong
      const href = safeUrl(part.href)
      // Don't repeat the destination when the label already is it — a mailto
      // link labelled with its own address would read "a@b (mailto:a@b)".
      if (!href || href === part.label || href === `mailto:${part.label}`) {
        return part.label
      }
      return `${part.label} (${href})`
    })
    .join('')

/** The one-line statement of what happened. Sentence case, never a greeting. */
export const headline = (text: string): EmailBlock => ({
  html: `<h1 style="margin:0 0 12px;font-family:${FONT_STACK};font-size:19px;font-weight:600;letter-spacing:-0.01em;line-height:1.35;color:${TEXT};">${escapeHtml(text)}</h1>`,
  text
})

/**
 * Body copy under the headline.
 *
 * `tight` shrinks the bottom margin for a paragraph that runs straight into a
 * following block. It looks like a no-op and is not: in a standards engine the
 * 4px collapses with the next block's 20px `margin-top` to 20px — the same gap
 * the default would give — but Outlook's Word engine does not collapse margins
 * at all. There it sums, so `tight` yields 4+20=24px against the 20px every
 * other client shows, where the default would give 40px. It exists to keep
 * Outlook close to the design, and removing it would widen that gap, not
 * tidy up dead code.
 */
export const paragraph = (
  content: InlineContent,
  options: { tight?: boolean } = {}
): EmailBlock => ({
  html: `<p style="margin:0 0 ${options.tight ? '4px' : '20px'};font-family:${FONT_STACK};font-size:14px;line-height:1.65;color:${TEXT_BODY};word-wrap:break-word;">${renderInlineHtml(content)}</p>`,
  text: renderInlineText(content)
})

/** Small muted caption above a quote block — "Your post:", "Reply:". */
export const label = (text: string): EmailBlock => ({
  html: `<p style="margin:0 0 8px;font-family:${FONT_STACK};font-size:13px;color:${TEXT_MUTED};">${escapeHtml(text)}</p>`,
  text
})

/**
 * The single call to action. Bulletproof shape: the background sits on the
 * `td` (Outlook ignores the anchor's `border-radius` and would otherwise render
 * white-on-white) and the anchor is `display:block` so the whole box is a hit
 * target.
 *
 * Returns an empty block for an unusable URL, so a hostile `status.url` yields
 * an email with no button rather than a dangerous one.
 */
export const button = (options: { label: string; url: string }): EmailBlock => {
  const url = safeUrl(options.url)
  if (!url) return EMPTY_BLOCK
  return {
    html:
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
      // mso-padding-alt gives Outlook the padding it otherwise loses: the Word
      // engine ignores `display:block`, so the anchor stays inline and its
      // vertical padding adds no height to the line box — leaving a 20px-tall
      // orange strip instead of a 40px button.
      `<td align="center" bgcolor="${BUTTON_BACKGROUND}" style="background-color:${BUTTON_BACKGROUND};border-radius:${RADIUS_BUTTON};mso-padding-alt:10px 20px;">` +
      // mso-padding-alt:0 on the anchor is the other half of the recipe: Word
      // DOES apply horizontal padding to an inline element, so without the
      // reset the button gets the cell's 20px plus the anchor's 20px on each
      // side. Every other client ignores the property.
      `<a href="${escapeHtml(url)}" style="display:block;padding:10px 20px;mso-padding-alt:0;font-family:${FONT_STACK};font-size:14px;font-weight:500;line-height:20px;color:${BUTTON_TEXT};text-decoration:none;border-radius:${RADIUS_BUTTON};">${escapeHtml(options.label)}</a>` +
      `</td></tr></table>`,
    text: `${options.label}: ${url}`
  }
}

/**
 * The copy-me-instead line under a button, for clients that strip links.
 * Contributes nothing to the text part — the button line already printed the
 * same URL, and repeating it reads as a duplicate.
 */
export const fallbackUrl = (url: string): EmailBlock => {
  const safe = safeUrl(url)
  if (!safe) return EMPTY_BLOCK
  return {
    html:
      `<p style="margin:16px 0 0;font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:${TEXT_MUTED};">Or open this link in your browser:<br>` +
      // word-wrap is the Microsoft-origin property and is the only one Outlook's
      // Word engine honours; word-break covers everything else. Both are needed:
      // a real verification link is ~98 characters (the codes are 43-char
      // base64url), which overflows the 544px card interior as one unbreakable
      // token.
      `<a href="${escapeHtml(safe)}" style="color:${TEXT_MUTED};text-decoration:underline;word-break:break-all;word-wrap:break-word;">${escapeHtml(safe)}</a></p>`,
    text: ''
  }
}

/**
 * The closing caveat inside the card — "if you didn't request this", link
 * expiry, who to contact. Separated from the body by a hairline rule.
 */
export const note = (content: InlineContent): EmailBlock => ({
  html: `<p style="margin:20px 0 0;padding-top:16px;border-top:1px solid ${BORDER_SUBTLE};font-family:${FONT_STACK};font-size:13px;line-height:1.6;color:${TEXT_MUTED};word-wrap:break-word;">${renderInlineHtml(content)}</p>`,
  text: renderInlineText(content)
})

/**
 * A post body that has ALREADY been through the sanitize/markdown pipeline.
 *
 * This is the one and only value the layout emits without escaping, which is
 * why it is a named type rather than a bare string: a plain `string` parameter
 * would make it far too easy to hand raw remote text straight into the HTML.
 * Build it with `getStatusBody`, never by hand.
 */
export interface SanitizedBody {
  readonly html: string
  readonly text: string
}

/**
 * The muted inset card quoting an actor — their monogram, display name and
 * handle, optionally over the post body.
 *
 * `follow`/`followRequest` pass no body (the actor row is the whole point);
 * `like`/`boost` quote the RECIPIENT's own post, `mention`/`reply` the sender's.
 */
export const quote = (options: {
  author: QuoteAuthor
  body?: SanitizedBody
}): EmailBlock => {
  const { author, body } = options
  const initials = getInitials(author.displayName)
  const monogram = getMonogramColor(author.handle)

  const bodyHtml = body
    ? `<div style="margin-top:8px;font-family:${FONT_STACK};font-size:14px;line-height:1.6;color:${TEXT_BODY};word-wrap:break-word;">${body.html}</div>`
    : ''

  return {
    html:
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>` +
      `<td bgcolor="${INSET_BACKGROUND}" style="background-color:${INSET_BACKGROUND};border:1px solid ${BORDER};border-radius:${RADIUS_INSET};padding:14px 16px;">` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
      // line-height equal to the height is what centres the initials vertically
      // in Outlook, which ignores flex and vertical-align on a coloured box.
      `<td width="24" height="24" align="center" bgcolor="${monogram}" style="width:24px;height:24px;border-radius:${RADIUS_FULL};color:${BUTTON_TEXT};font-family:${FONT_STACK};font-size:10px;font-weight:600;line-height:24px;">${escapeHtml(initials)}</td>` +
      `<td style="padding-left:8px;font-family:${FONT_STACK};font-size:14px;font-weight:600;color:${TEXT_STRONG};white-space:nowrap;">${escapeHtml(author.displayName)}</td>` +
      `<td style="padding-left:6px;font-family:${FONT_STACK};font-size:13px;color:${TEXT_CHROME};">${escapeHtml(author.handle)}</td>` +
      `</tr></table>${bodyHtml}` +
      `</td></tr></table>`,
    text: body
      ? `${author.displayName} (${author.handle})\n${body.text}`
      : `${author.displayName} (${author.handle})`
  }
}
