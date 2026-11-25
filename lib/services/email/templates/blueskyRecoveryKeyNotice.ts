import { type EmailBrand, brandHost } from '@/lib/services/email/brand'
import { headline, note, paragraph } from '@/lib/services/email/layout/blocks'
import { renderEmail } from '@/lib/services/email/layout/renderEmail'
import { RenderedEmail } from '@/lib/services/email/types'

export interface BlueskyRecoveryKeyNoticeParams {
  /** The account's address. */
  recipientEmail: string
  /** The hosted Bluesky account's handle. */
  handle: string
  /** The `did:key` now set, or null when the recovery key was removed. */
  recoveryKeyDid: string | null
  /** The domain's admin contact, when it has one. */
  contactEmail?: string | null
  /** The account's domain name and host; the primary's when omitted. */
  brand?: EmailBrand
}

/**
 * Tells the owner that the recovery key on their hosted Bluesky account was
 * added or removed. A recovery key can take the account's identity away from
 * this server, so a change the owner did not make must reach them.
 */
export const buildBlueskyRecoveryKeyNoticeEmail = ({
  recipientEmail,
  handle,
  recoveryKeyDid,
  contactEmail,
  brand
}: BlueskyRecoveryKeyNoticeParams): RenderedEmail => {
  const host = brandHost(brand)
  const title = recoveryKeyDid
    ? 'A recovery key was added to your Bluesky account'
    : 'The recovery key was removed from your Bluesky account'

  return renderEmail({
    brand,
    subject: title,
    preheader: `The recovery key on @${handle} changed.`,
    blocks: [
      headline(title),
      paragraph(
        recoveryKeyDid
          ? `The Bluesky account @${handle} on ${host} now has the recovery key ${recoveryKeyDid}. Whoever holds that key can move the account to another server.`
          : `The Bluesky account @${handle} on ${host} no longer has a recovery key.`
      ),
      note(
        contactEmail
          ? `If this wasn't you, contact the administrator at ${contactEmail} and change your password.`
          : "If this wasn't you, contact the administrator and change your password."
      )
    ],
    footer: { kind: 'account', recipientEmail }
  })
}
