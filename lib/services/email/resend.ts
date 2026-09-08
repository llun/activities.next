import memoize from 'lodash/memoize'
import { Resend } from 'resend'

import type { Message, ResendConfig } from '@/lib/config/email'

import { getAddressFromEmail } from './address'

const getResend = memoize((config: ResendConfig) => {
  return new Resend(config.token)
})

export async function sendResendMail(
  message: Message,
  config: ResendConfig
): Promise<void> {
  const resend = getResend(config)
  const result = await resend.emails.send({
    from: getAddressFromEmail(message.from),
    to: message.to.map((email) => getAddressFromEmail(email)),
    subject: message.subject,
    ...(message.replyTo
      ? { replyTo: getAddressFromEmail(message.replyTo) }
      : null),
    html: message.content.html,
    text: message.content.text
  })

  if (result.error) {
    const details =
      result.error instanceof Error
        ? result.error.message
        : JSON.stringify(result.error)

    throw new Error(`Resend email delivery failed: ${details}`, {
      cause: result.error
    })
  }
}
