import { getConfig } from '@/lib/config'
import { getServedLinkDomain } from '@/lib/services/domains/localDomains'
import { sendMail } from '@/lib/services/email'
import { buildVerifyEmail } from '@/lib/services/email/templates/verifyEmail'

export interface SendConfirmationEmailParams {
  recipient: string
  verificationCode: string
  /**
   * The domain of the account's actor. The link is built on it when this
   * server answers on that domain (the primary host or an
   * `ACTIVITIES_TRUSTED_HOSTS` entry), and on the primary host otherwise.
   */
  actorDomain?: string | null
}

// Sends (or resends) the registration confirmation email. The link points at
// /auth/confirmation, which verifyAccount consumes to clear verificationCode,
// on the account's actor domain when this server answers on it (an account
// whose actor lives on a second domain confirms there), else on the primary
// host. Registration passes no actor domain, so its first email is always on
// the primary host, where sign-up creates the first actor.
// No-ops when email delivery is not configured; rejections from sendMail are
// allowed to propagate so callers can decide how to handle delivery failures.
export const sendConfirmationEmail = async ({
  recipient,
  verificationCode,
  actorDomain
}: SendConfirmationEmailParams): Promise<void> => {
  const config = getConfig()
  if (!config.email) return

  const email = buildVerifyEmail({
    recipientEmail: recipient,
    verificationCode,
    domain: getServedLinkDomain(actorDomain)
  })

  await sendMail({
    from: config.email.serviceFromAddress,
    to: [recipient],
    subject: email.subject,
    content: { text: email.text, html: email.html }
  })
}
