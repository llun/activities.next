import { getBaseURL, getConfig } from '@/lib/config'
import { SanitizedBody } from '@/lib/services/email/layout/blocks'
import { EditableStatus } from '@/lib/types/domain/status'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'
import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'
import { sanitizeText } from '@/lib/utils/text/sanitizeText'

// Rewrites root-relative hrefs to absolute ones. A mail client has no origin to
// resolve them against, so `/tags/x` is simply a dead link in an inbox.
//
// convertMarkdownText emits exactly that for every hashtag
// (`<a href="/tags/foo" …>`), which is why the mention and reply emails have
// been shipping dead hashtag links. sanitizeText also permits a schemeless href
// on the remote path, so both pipelines need this.
//
// Only `href="/…"` is rewritten, never `href="//…"` — a protocol-relative URL
// points at another origin entirely and must not be silently re-homed.
const absolutizeLinks = (html: string): string =>
  html.replace(
    /(\s(?:href|src)=")\/(?!\/)/g,
    (_match, attribute: string) => `${attribute}${getBaseURL()}/`
  )

/**
 * Render a status body for an email: HTML through the same sanitize/markdown
 * pipeline the web UI uses, plus the plain-text twin derived from it.
 *
 * The text side is derived rather than hand-written because the source is
 * already HTML — the previous templates printed `status.text` raw into the text
 * part, which for a remote actor meant a wall of markup.
 */
export const getStatusBody = (status: EditableStatus): SanitizedBody => {
  const html = absolutizeLinks(
    status.isLocalActor
      ? convertMarkdownText(getConfig().host)(status.text)
      : sanitizeText(status.text)
  )
  return { html, text: htmlToPlainText(html) }
}
