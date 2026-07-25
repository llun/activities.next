import { getBaseURL, getConfig } from '@/lib/config'
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
}

/** Password reset. The stored code is hashed; this carries the plaintext one. */
export const buildResetPasswordEmail = ({
  recipientEmail,
  passwordResetCode
}: ResetPasswordParams): RenderedEmail => {
  const { host } = getConfig()
  const url = `${getBaseURL()}/auth/reset-password?code=${encodeURIComponent(passwordResetCode)}`

  return renderEmail({
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
