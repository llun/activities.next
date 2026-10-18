import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { getServedLinkDomain } from '@/lib/services/domains/localDomains'
import { sendMail } from '@/lib/services/email'
import { buildVerifyEmail } from '@/lib/services/email/templates/verifyEmail'

export interface SendConfirmationEmailParams {
  recipient: string
  verificationCode: string
  /**
   * The domain of the account's actor. The link is built on it when this
   * server serves that domain, and on the primary host otherwise.
   */
  actorDomain?: string | null
  database?: Database | null
}

// Sends (or resends) the registration confirmation email. The link points at
// /auth/confirmation, which verifyAccount consumes to clear verificationCode,
// on the account's actor domain when this server serves it (an account whose
// actor lives on a second domain confirms there), else on the primary host.
// No-ops when email delivery is not configured; rejections from sendMail are
// allowed to propagate so callers can decide how to handle delivery failures.
export const sendConfirmationEmail = async ({
  recipient,
  verificationCode,
  actorDomain,
  database = null
}: SendConfirmationEmailParams): Promise<void> => {
  const config = getConfig()
  if (!config.email) return

  const email = buildVerifyEmail({
    recipientEmail: recipient,
    verificationCode,
    domain: await getServedLinkDomain(database, actorDomain)
  })

  await sendMail({
    from: config.email.serviceFromAddress,
    to: [recipient],
    subject: email.subject,
    content: { text: email.text, html: email.html }
  })
}
