import { buildBaseURL, getBaseURL } from '@/lib/config'
import { type EmailBrand, brandHost } from '@/lib/services/email/brand'
import {
  button,
  fallbackUrl,
  headline,
  note,
  paragraph
} from '@/lib/services/email/layout/blocks'
import { renderEmail } from '@/lib/services/email/layout/renderEmail'
import { RenderedEmail } from '@/lib/services/email/types'

export interface ChangeEmailParams {
  /** The NEW address — this email is sent there, not to the current one. */
  recipientEmail: string
  emailChangeCode: string
  /**
   * The domain of the account's actor, already checked to be one this server
   * serves (`getServedLinkDomain`); omitted or null means the primary host.
   */
  domain?: string | null
  /** The visited or recipient domain's name and host; the primary's when omitted. */
  brand?: EmailBrand
}

/** Confirms a requested email-address change before it is applied. */
export const buildChangeEmail = ({
  recipientEmail,
  emailChangeCode,
  domain,
  brand
}: ChangeEmailParams): RenderedEmail => {
  // The brand's domain wins; `domain` alone (no brand) keeps its own link and copy.
  const linkDomain = brand?.domain || domain
  const host = linkDomain || brandHost(brand)
  const baseURL = linkDomain ? buildBaseURL(linkDomain) : getBaseURL()
  const url = `${baseURL}/account/verify-email?code=${encodeURIComponent(emailChangeCode)}`

  return renderEmail({
    brand,
    subject: 'Verify your new email address',
    preheader: `Confirm the new email address for your ${host} account. The link expires in 24 hours.`,
    blocks: [
      headline('Verify your new email address'),
      paragraph(
        `You requested to change the email address for your account on ${host}. Confirm the new address to finish the change.`
      ),
      button({ label: 'Verify email address', url }),
      fallbackUrl(url),
      note(
        "If you didn't request this change, you can safely ignore this email. This link expires in 24 hours."
      )
    ],
    footer: { kind: 'account', recipientEmail }
  })
}
