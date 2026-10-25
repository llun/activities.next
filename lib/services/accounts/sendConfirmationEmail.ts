import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { getServedLinkDomain } from '@/lib/services/domains/localDomains'
import { sendMail } from '@/lib/services/email'
import { resolveEmailIdentity } from '@/lib/services/email/sender'
import { buildVerifyEmail } from '@/lib/services/email/templates/verifyEmail'

export interface SendConfirmationEmailParams {
  // Names the domain the email is for (its identity is read from it).
  database: Database
  recipient: string
  verificationCode: string
  /**
   * The domain of the account's actor. The link is built on it when this
   * server answers on that domain (the primary host, an
   * `ACTIVITIES_TRUSTED_HOSTS` entry or an active Admin › Served domains row), and on
   * the primary host otherwise.
   */
  actorDomain?: string | null
}

// Sends (or resends) the registration confirmation email. The link points at
// /auth/confirmation, which verifyAccount consumes to clear verificationCode,
// on the account's actor domain when this server answers on it (an account
// whose actor lives on a second domain confirms there), else on the primary
// host. Registration passes the domain it created the first actor on (the
// domain the visitor signed up on), so the first link goes back there.
// No-ops when email delivery is not configured; rejections from sendMail are
// allowed to propagate so callers can decide how to handle delivery failures.
export const sendConfirmationEmail = async ({
  database,
  recipient,
  verificationCode,
  actorDomain
}: SendConfirmationEmailParams): Promise<void> => {
  const config = getConfig()
  if (!config.email) return

  // The email carries the name of the domain the link points at, and is sent
  // under it (the primary when the actor's domain is not one this server serves).
  const domain = getServedLinkDomain(actorDomain)
  const { brand, from } = await resolveEmailIdentity(database, domain)
  const email = buildVerifyEmail({
    recipientEmail: recipient,
    verificationCode,
    domain,
    brand
  })

  await sendMail({
    from,
    to: [recipient],
    subject: email.subject,
    content: { text: email.text, html: email.html }
  })
}
