import { Marked, type Tokens } from 'marked'
import sanitizeHtml from 'sanitize-html'

import { escapeHtml } from '@/lib/utils/text/escapeHtml'
import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'

// Renders a terms of service or privacy policy, written by an admin in
// Markdown, to HTML. Server-side only: the instance endpoints send the HTML,
// and the policy pages parse it with html-react-parser. renderPolicyMarkdown
// preserves the API HTML; renderPolicyPage adds generated h2 ids, a plain-text
// heading index and token-derived policy-label classes for page typography.
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

export type PolicyHeading = { id: string; text: string }

const createPolicyMarked = (headings?: PolicyHeading[]) => {
  const usedIds = new Set<string>()
  let headingPosition = 0

  return new Marked({
    gfm: true,
    breaks: false,
    async: false,
    renderer: {
      ...(headings
        ? {
            heading({ depth, tokens }: Tokens.Heading) {
              const inline = this.parser.parseInline(tokens)
              if (depth !== 2) return `<h${depth}>${inline}</h${depth}>\n`

              headingPosition += 1
              const text = htmlToPlainText(inline)
              if (!text) return `<h2>${inline}</h2>\n`

              const slug = text
                .normalize('NFKD')
                .replace(/\p{M}/gu, '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
              const base = `section-${slug || headingPosition}`
              let id = base
              let suffix = 2
              while (usedIds.has(id)) id = `${base}-${suffix++}`
              usedIds.add(id)
              headings.push({ id, text })
              return `<h2 id="${id}">${inline}</h2>\n`
            },
            paragraph({ tokens }: Tokens.Paragraph) {
              const content = tokens.filter(
                (token) => token.type !== 'text' || token.text.trim() !== ''
              )
              const label = content.length === 1 && content[0].type === 'strong'
              return `<p${label ? ' class="policy-label"' : ''}>${this.parser.parseInline(tokens)}</p>\n`
            }
          }
        : {}),
      // Redcarpet's escape_html: raw HTML is shown, not interpreted.
      html({ text, block }: Tokens.HTML | Tokens.Tag) {
        if (!block) return escapeHtml(text)
        const trimmed = text.trim()
        return trimmed ? `<p>${escapeHtml(trimmed)}</p>\n` : ''
      },
      // Redcarpet's no_images: an image is reduced to its alt text.
      image({ text }: Tokens.Image) {
        return escapeHtml(text)
      },
      // Redcarpet has no task lists: `- [ ] a` shows its brackets as text.
      // Sanitizing would drop the <input> and leave nothing to tell a checked
      // item from an unchecked one.
      checkbox({ checked }: Tokens.Checkbox) {
        return checked ? '[x] ' : '[ ] '
      }
    }
  })
}

const normalizeHeadingText = (value: string) =>
  value.replace(/\s+/g, ' ').trim().toLowerCase()

export type RenderPolicyMarkdownOptions = {
  // The visited domain, substituted for `%{domain}`.
  domain: string
}

const renderPolicy = (
  markdown: string,
  { domain }: RenderPolicyMarkdownOptions,
  page?: { title: string; headings: PolicyHeading[] }
) => {
  const marked = createPolicyMarked(page?.headings)
  // A TokensList: an array that also carries the document's link
  // definitions, so it is edited in place rather than copied.
  const tokens = marked.lexer(markdown.replaceAll('%{domain}', domain))

  if (page) {
    const first = tokens.findIndex((token) => token.type !== 'space')
    const leading = tokens[first]
    if (
      leading?.type === 'heading' &&
      (leading as Tokens.Heading).depth === 1 &&
      normalizeHeadingText((leading as Tokens.Heading).text) ===
        normalizeHeadingText(page.title)
    ) {
      tokens.splice(first, 1)
    }
    marked.walkTokens(tokens, (token) => {
      if (token.type === 'heading' && (token as Tokens.Heading).depth === 1) {
        ;(token as Tokens.Heading).depth = 2
      }
    })
  }

  // Rendering collects the generated ids before the sanitizer allowlist is
  // built. Authors cannot supply attributes: raw HTML is always escaped.
  const html = marked.parser(tokens)
  const options = page
    ? {
        ...POLICY_SANITIZE_OPTIONS,
        allowedAttributes: {
          ...POLICY_SANITIZE_OPTIONS.allowedAttributes,
          h2: [{ name: 'id', values: page.headings.map(({ id }) => id) }]
        },
        allowedClasses: { p: ['policy-label'] }
      }
    : POLICY_SANITIZE_OPTIONS
  return sanitizeHtml(html, options).trim()
}

/** API HTML, without page-only ids, classes or heading transformations. */
export const renderPolicyMarkdown = (
  markdown: string,
  options: RenderPolicyMarkdownOptions
): string => renderPolicy(markdown, options)

/** Page HTML and its h2 index, keeping the page's own title as the only h1. */
export const renderPolicyPage = (
  markdown: string,
  { title, ...options }: RenderPolicyMarkdownOptions & { title: string }
): { html: string; headings: PolicyHeading[] } => {
  const headings: PolicyHeading[] = []
  const html = renderPolicy(markdown, options, { title, headings })
  return { html, headings }
}
