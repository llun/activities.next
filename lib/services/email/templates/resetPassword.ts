import {
  type EmailBrand,
  brandBaseURL,
  brandHost
} from '@/lib/services/email/brand'
import {
  button,
  fallbackUrl,
  headline,
  note,
  paragraph
} from '@/lib/services/email/layout/blocks'
import { renderEmail } from '@/lib/services/email/layout/renderEmail'
import { RenderedEmail } from '@/lib/services/email/types'

export interface ResetPasswordParams {
  recipientEmail: string
  passwordResetCode: string
  /** The visited or recipient domain's name and host; the primary's when omitted. */
  brand?: EmailBrand
}

/** Password reset. The stored code is hashed; this carries the plaintext one. */
export const buildResetPasswordEmail = ({
  recipientEmail,
  passwordResetCode,
  brand
}: ResetPasswordParams): RenderedEmail => {
  const host = brandHost(brand)
  const url = `${brandBaseURL(brand)}/auth/reset-password?code=${encodeURIComponent(passwordResetCode)}`

  return renderEmail({
    brand,
    subject: 'Reset your password',
    preheader: `Choose a new password for your ${host} account. The link expires in 24 hours.`,
    blocks: [
      headline('Reset your password'),
      paragraph(
        `You requested a password reset for your account on ${host}. Open the link below to choose a new password.`
      ),
      button({ label: 'Reset password', url }),
      fallbackUrl(url),
      note(
        'If you did not request this, you can safely ignore this email. This link expires in 24 hours.'
      )
    ],
    footer: { kind: 'account', recipientEmail }
  })
}
