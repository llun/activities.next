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
  // Markdown for a local author, then sanitize ALWAYS — the same order as
  // processStatusTextContent, which is what the web UI renders through.
  //
  // These must not become an either/or. `marked` has shipped no sanitizer since
  // v5, so running only the markdown step lets a local author put raw HTML
  // straight into another user's inbox: a tracking pixel (read receipt plus IP),
  // a <style> block that hides the real card, or arbitrary anchor markup for
  // phishing. `quote()` emits this value unescaped, so sanitizing here is the
  // only thing standing between a post body and the recipient's mail client.
  const rendered = status.isLocalActor
    ? convertMarkdownText(getConfig().host)(status.text)
    : status.text
  // Absolutize after sanitizing, so only hrefs that survived it are rewritten.
  const html = absolutizeLinks(sanitizeText(rendered))
  return { html, text: htmlToPlainText(html) }
}
