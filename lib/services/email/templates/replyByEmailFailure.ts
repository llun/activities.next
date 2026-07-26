import { getConfig } from '@/lib/config'
import { button, headline, paragraph } from '@/lib/services/email/layout/blocks'
import { renderEmail } from '@/lib/services/email/layout/renderEmail'
import { RenderedEmail } from '@/lib/services/email/types'

// A dropped email reply is invisible to whoever sent it — they believe they
// posted. This notice turns the worst failure mode (silent data loss) into an
// ordinary one.
//
// It deliberately carries no `replyMarker` and no `Reply-To`: a notice about a
// failed reply must not itself be repliable, or a misconfigured mailbox could
// bounce it around the loop. The `account` footer is right for the same
// reason — it is not one of the social events the notification settings can
// switch off, so there is no toggle to link to.
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

export interface ReplyByEmailFailureParams {
  reason: ReplyByEmailFailureReason
  recipientEmail: string
  /**
   * The thread the reply was meant for. Omitted when it is gone, and dropped
   * by the block builder unless it is a usable http(s) URL — it can originate
   * from a remote server.
   */
  statusUrl?: string
}

const isWebUrl = (statusUrl?: string) => {
  if (!statusUrl) return false
  try {
    const url = new URL(statusUrl)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export const buildReplyByEmailFailureEmail = ({
  reason,
  recipientEmail,
  statusUrl
}: ReplyByEmailFailureParams): RenderedEmail =>
  renderEmail({
    subject: `Your reply was not posted to ${getConfig().host}`,
    preheader: 'Nothing was published — here is why.',
    blocks: [
      headline('We could not post your emailed reply'),
      paragraph(['Reason: ', { strong: REASONS[reason] }, '.']),
      paragraph('Nothing was published.', { tight: true }),
      ...(isWebUrl(statusUrl)
        ? [button({ label: 'Reply from the web', url: statusUrl as string })]
        : [])
    ],
    footer: { kind: 'account', recipientEmail }
  })
