import { getConfig } from '@/lib/config'
import { sendMail } from '@/lib/services/email'

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

  await sendMail({
    from: config.email.serviceFromAddress,
    to: [recipient],
    subject: 'Email verification',
    content: {
      text: `Open this link to verify your email https://${config.host}/auth/confirmation?verificationCode=${verificationCode}`,
      html: `Open <a href="https://${config.host}/auth/confirmation?verificationCode=${verificationCode}">this link</a> to verify your email.`
    }
  })
}
