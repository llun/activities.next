import { escapeHtml } from '@/lib/utils/text/escapeHtml'

const MARKDOWN_MEDIA_TYPES = new Set(['text/markdown', 'text/x-markdown'])

export const isMarkdownMediaType = (mediaType: unknown): boolean =>
  typeof mediaType === 'string' &&
  MARKDOWN_MEDIA_TYPES.has(mediaType.split(';')[0].trim().toLowerCase())

// Every quantifier is bounded or cannot overlap its own terminator, so a long
// run of `[` with no `]` (or a very long URL-like token) cannot backtrack
// quadratically. The label excludes `[` so an unclosed `[` fails at once.
const LINK_PATTERN =
  /\[([^[\]\n]{1,1000})\]\((https?:\/\/[^\s)]{1,2000})\)|(https?:\/\/[^\s<]{1,2000})/g

const renderInline = (line: string): string => {
  let result = ''
  let last = 0
  for (const match of line.matchAll(LINK_PATTERN)) {
    result += escapeHtml(line.slice(last, match.index))
    const [raw, label, markdownHref, bareHref] = match
    let href = markdownHref ?? bareHref
    let text = label ?? bareHref
    let trailing = ''
    if (bareHref) {
      // Keep sentence punctuation out of an auto-linked URL.
      // A backward scan: a trailing-run regex is quadratic on a long
      // punctuation run followed by another character.
      let end = href.length
      while (end > 0 && '.,;:!?)]'.includes(href[end - 1])) end--
      if (end < href.length) {
        trailing = href.slice(end)
        href = href.slice(0, end)
        text = href
      }
    }
    result += `<a href="${escapeHtml(href)}" rel="nofollow noopener noreferrer" target="_blank">${escapeHtml(text)}</a>${escapeHtml(trailing)}`
    last = (match.index ?? 0) + raw.length
  }
  return result + escapeHtml(line.slice(last))
}

/**
 * Minimal, safe markdown to HTML for remote content that declares
 * `text/markdown` (PeerTube video descriptions). Everything is escaped, blank
 * lines split paragraphs, single newlines become `<br>`, and only http(s)
 * `[text](url)` links and bare URLs become anchors. Formatting that needs a
 * full parser (lists, emphasis, headings) stays as plain text rather than
 * adding a dependency. The result still goes through the normal sanitizer at
 * render time.
 */
export const renderRemoteMarkdown = (markdown: unknown): string =>
  typeof markdown !== 'string'
    ? ''
    : markdown
        .replace(/\r\n?/g, '\n')
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map(
          (paragraph) =>
            `<p>${paragraph.split('\n').map(renderInline).join('<br>')}</p>`
        )
        .join('')
