import { type EmailBrand, brandHost } from '@/lib/services/email/brand'
import { headline, note, paragraph } from '@/lib/services/email/layout/blocks'
import { renderEmail } from '@/lib/services/email/layout/renderEmail'
import { RenderedEmail } from '@/lib/services/email/types'

export interface EmailChangeNoticeParams {
  /** The OLD address — this notice goes there, not to the requested one. */
  recipientEmail: string
  /** The address the change was requested to. Masked before it is rendered. */
  newEmail: string
  /** The domain's admin contact, when it has one. */
  contactEmail?: string | null
  /** The visited or recipient domain's name and host; the primary's when omitted. */
  brand?: EmailBrand
}

/**
 * Masks the local part of an address so the notice names the requested
 * destination without printing it in full: `alice@example.com` becomes
 * `a***@example.com`. The domain stays readable, because it is the part the
 * owner needs to recognise.
 */
export const maskEmailAddress = (email: string): string => {
  const at = email.lastIndexOf('@')
  if (at <= 0) return '***'
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const visible = local.slice(0, 1)
  return `${visible}***@${domain}`
}

/**
 * Tells the current address that an email change was requested. It carries no
 * link: the change is confirmed from the new address, and this is the notice
 * that lets the owner object to one they did not ask for.
 */
export const buildEmailChangeNoticeEmail = ({
  recipientEmail,
  newEmail,
  contactEmail,
  brand
}: EmailChangeNoticeParams): RenderedEmail => {
  const host = brandHost(brand)
  const masked = maskEmailAddress(newEmail)

  return renderEmail({
    brand,
    subject: 'An email change was requested',
    preheader: `A change to ${masked} was requested for your ${host} account.`,
    blocks: [
      headline('An email change was requested'),
      paragraph(
        `Someone asked to change the email address on your ${host} account to ${masked}. We sent a verification link to that address. The change is not applied until the link is opened.`
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
