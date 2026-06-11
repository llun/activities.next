import { getBaseURL, getConfig } from '@/lib/config'
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

  // getBaseURL() honors the configured scheme/host/port, so confirmation links
  // are correct on http/local/custom-port deployments rather than assuming https.
  const confirmationUrl = `${getBaseURL()}/auth/confirmation?verificationCode=${verificationCode}`

  await sendMail({
    from: config.email.serviceFromAddress,
    to: [recipient],
    subject: 'Email verification',
    content: {
      text: `Open this link to verify your email ${confirmationUrl}`,
      html: `Open <a href="${confirmationUrl}">this link</a> to verify your email.`
    }
  })
}
