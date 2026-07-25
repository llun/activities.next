import { getConfig } from '@/lib/config'
import { sendMail } from '@/lib/services/email'
import { buildVerifyEmail } from '@/lib/services/email/templates/verifyEmail'

export interface SendConfirmationEmailParams {
  recipient: string
  verificationCode: string
}

// Sends (or resends) the registration confirmation email. The link points at
// /auth/confirmation, which verifyAccount consumes to clear verificationCode.
// No-ops when email delivery is not configured; rejections from sendMail are
// allowed to propagate so callers can decide how to handle delivery failures.
export const sendConfirmationEmail = async ({
  recipient,
  verificationCode
}: SendConfirmationEmailParams): Promise<void> => {
  const config = getConfig()
  if (!config.email) return

  const email = buildVerifyEmail({
    recipientEmail: recipient,
    verificationCode
  })

  await sendMail({
    from: config.email.serviceFromAddress,
    to: [recipient],
    subject: email.subject,
    content: { text: email.text, html: email.html }
  })
}
