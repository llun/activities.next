import memoize from 'lodash/memoize'
import type { Resend as ResendType } from 'resend'

import type { Message, ResendConfig } from '@/lib/config/email'
import { dynamicImport } from '@/lib/utils/dynamicImport'

import { getAddressFromEmail } from './address'

const getResendClass = memoize(async () => {
  const mod = await dynamicImport<{
    Resend?: typeof ResendType
    default?: typeof ResendType
  }>('resend')
  return mod.Resend ?? mod.default ?? (mod as unknown as typeof ResendType)
})

const getResend = memoize(async (config: ResendConfig) => {
  const ResendClass = await getResendClass()
  return new ResendClass(config.token)
})

export async function sendResendMail(
  message: Message,
  config: ResendConfig
): Promise<void> {
  const resend = await getResend(config)
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
