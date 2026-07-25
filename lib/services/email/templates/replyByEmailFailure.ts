import { getConfig } from '@/lib/config'

// A dropped email reply is invisible to whoever sent it — they believe they
// posted. This notice turns the worst failure mode (silent data loss) into an
// ordinary one. It carries no Reply-To of its own, so answering it cannot loop
// back into the reply pipeline.
export type ReplyByEmailFailureReason =
  | 'empty'
  | 'too-long'
  | 'disabled-account'
  | 'disabled-instance'
  | 'thread-missing'
  | 'not-posted'

const REASONS: Record<ReplyByEmailFailureReason, string> = {
  empty: 'the message had no text above the quoted original',
  'too-long': 'the message was longer than this server allows for a post',
  // Kept separate because the account setting is hidden from Settings →
  // Notifications while the instance switch is off: telling someone to change
  // a toggle they cannot see sends them looking for something that is not
  // there.
  'disabled-account':
    'reply by email is switched off for your account — you can turn it back on under Settings, Notifications',
  'disabled-instance': 'reply by email is switched off on this server',
  'thread-missing': 'the post being replied to is no longer available',
  'not-posted':
    'the server could not publish it (a direct thread with no recipients, or a blocked or muted conversation)'
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character])

// The thread URL can originate from a remote server, so it is parsed and
// restricted to http/https before it is allowed to become an href (see the
// URL-validation rule in REVIEW.md). An unusable value degrades to the
// link-free wording rather than shipping an unchecked scheme into a mail
// client.
const safeHref = (statusUrl?: string) => {
  if (!statusUrl) return null
  try {
    const url = new URL(statusUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export const getSubject = () =>
  `Your reply was not posted to ${getConfig().host}`

export const getTextContent = (
  reason: ReplyByEmailFailureReason,
  statusUrl?: string
) => {
  const href = safeHref(statusUrl)
  return [
    'We could not post your emailed reply.',
    '',
    `Reason: ${REASONS[reason]}.`,
    '',
    href
      ? `Nothing was published. You can still reply from the web: ${href}`
      : 'Nothing was published. You can still reply from the web.'
  ].join('\n')
}

export const getHTMLContent = (
  reason: ReplyByEmailFailureReason,
  statusUrl?: string
) => {
  const href = safeHref(statusUrl)
  return [
    '<h3>We could not post your emailed reply</h3>',
    `<p><strong>Reason:</strong> ${REASONS[reason]}.</p>`,
    href
      ? `<p>Nothing was published. You can still <a href="${escapeHtml(href)}">reply from the web</a>.</p>`
      : '<p>Nothing was published. You can still reply from the web.</p>'
  ].join('\n')
}
