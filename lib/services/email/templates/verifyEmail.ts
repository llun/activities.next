import { buildBaseURL, getBaseURL, getConfig } from '@/lib/config'
import {
  button,
  fallbackUrl,
  headline,
  note,
  paragraph
} from '@/lib/services/email/layout/blocks'
import { renderEmail } from '@/lib/services/email/layout/renderEmail'
import { RenderedEmail } from '@/lib/services/email/types'

export interface VerifyEmailParams {
  recipientEmail: string
  verificationCode: string
  /**
   * The domain of the account's actor, already checked to be one this server
   * serves (`getServedLinkDomain`). The link and the copy name it so the
   * account is confirmed where it lives; omitted or null means the primary
   * host.
   */
  domain?: string | null
}

/**
 * Registration confirmation. Sent on sign-up and on every resend through the
 * confirmations endpoint; the link is what `verifyAccount` consumes to clear
 * the pending code.
 */
export const buildVerifyEmail = ({
  recipientEmail,
  verificationCode,
  domain
}: VerifyEmailParams): RenderedEmail => {
  const host = domain || getConfig().host
  // getBaseURL()/buildBaseURL() honour the configured scheme and port, so the
  // link is correct on http/local/custom-port deployments rather than assuming
  // https. The code is base64url, so encoding is a no-op today — it is here so
  // a future code format cannot silently produce a broken query string.
  const baseURL = domain ? buildBaseURL(domain) : getBaseURL()
  const url = `${baseURL}/auth/confirmation?verificationCode=${encodeURIComponent(verificationCode)}`

  return renderEmail({
    subject: 'Email verification',
    preheader: `Confirm your email address to finish creating your account on ${host}.`,
    blocks: [
      headline('Verify your email'),
      paragraph(
        `You're almost done. Confirm this email address to finish creating your account on ${host}.`
      ),
      button({ label: 'Verify email', url }),
      fallbackUrl(url),
      note(
        `If you didn't create an account on ${host}, you can safely ignore this email.`
      )
    ],
    footer: { kind: 'account', recipientEmail }
  })
}
