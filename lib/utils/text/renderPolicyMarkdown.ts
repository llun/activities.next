import { Marked, type Tokens } from 'marked'
import sanitizeHtml from 'sanitize-html'

import { escapeHtml } from '@/lib/utils/text/escapeHtml'

// Renders a terms of service or privacy policy, written by an admin in
// Markdown, to HTML. Server-side only: the instance endpoints send the HTML,
// and the policy pages parse it with html-react-parser.
//
// It follows Mastodon's REST::TermsOfServiceSerializer and
// REST::PrivacyPolicySerializer (Redcarpet with `escape_html` and
// `no_images`): raw HTML in the source shows as text instead of being
// interpreted, and images are not rendered. `%{domain}` is replaced with the
// visited domain, as Mastodon's `format(text, domain: ...)` does. The result is
// then sanitized against a fixed allowlist, so even a renderer bug cannot
// emit a script, a style or a `javascript:` link.

const POLICY_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'a',
    'strong',
    'em',
    'del',
    'code',
    'pre',
    'blockquote',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td'
  ],
  allowedAttributes: {
    a: ['href', 'title', 'rel', 'target']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', {
      rel: 'nofollow noopener noreferrer'
    })
  }
}

const createPolicyMarked = () =>
  new Marked({
    gfm: true,
    breaks: false,
    async: false,
    renderer: {
      // Redcarpet's escape_html: raw HTML is shown, not interpreted.
      html({ text, block }: Tokens.HTML | Tokens.Tag) {
        if (!block) return escapeHtml(text)
        const trimmed = text.trim()
        return trimmed ? `<p>${escapeHtml(trimmed)}</p>\n` : ''
      },
      // Redcarpet's no_images: an image is reduced to its alt text.
      image({ text }: Tokens.Image) {
        return escapeHtml(text)
      }
    }
  })

const normalizeHeadingText = (value: string) =>
  value.replace(/\s+/g, ' ').trim().toLowerCase()

export type RenderPolicyMarkdownOptions = {
  // The visited domain, substituted for `%{domain}`.
  domain: string
  // For the policy pages, which print the title themselves: a leading level-1
  // heading that repeats `title` is dropped, and every other level-1 heading
  // becomes a level-2 one, so the page keeps a single h1. The API leaves the
  // document as written.
  forPage?: { title: string }
}

/** Sanitized HTML for a Markdown policy document. */
export const renderPolicyMarkdown = (
  markdown: string,
  { domain, forPage }: RenderPolicyMarkdownOptions
): string => {
  const marked = createPolicyMarked()
  // A TokensList: an array that also carries the document's link
  // definitions, so it is edited in place rather than copied.
  const tokens = marked.lexer(markdown.replaceAll('%{domain}', domain))

  if (forPage) {
    const first = tokens.findIndex((token) => token.type !== 'space')
    const leading = tokens[first]
    if (
      leading?.type === 'heading' &&
      (leading as Tokens.Heading).depth === 1 &&
      normalizeHeadingText((leading as Tokens.Heading).text) ===
        normalizeHeadingText(forPage.title)
    ) {
      tokens.splice(first, 1)
    }
    marked.walkTokens(tokens, (token) => {
      if (token.type === 'heading' && (token as Tokens.Heading).depth === 1) {
        ;(token as Tokens.Heading).depth = 2
      }
    })
  }

  return sanitizeHtml(marked.parser(tokens), POLICY_SANITIZE_OPTIONS).trim()
}
