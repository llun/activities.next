import { escapeHtml } from '@/lib/utils/text/escapeHtml'

import {
  BORDER_SUBTLE,
  BUTTON_BACKGROUND,
  BUTTON_TEXT,
  FONT_STACK,
  RADIUS_BUTTON,
  TEXT,
  TEXT_BODY,
  TEXT_MUTED
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
 * Body copy under the headline. `tight` shrinks the bottom margin for a
 * paragraph that runs straight into a following block, matching the design's
 * two-paragraph actor-deleted card.
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
