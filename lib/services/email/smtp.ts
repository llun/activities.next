import memoize from 'lodash/memoize'
import type nodemailer from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'

import type { Message, SMTPConfig } from '@/lib/config/email'
import { dynamicImport } from '@/lib/utils/dynamicImport'

import { getAddressFromEmail } from './address'

const getNodemailer = memoize(async () => {
  const mod = await dynamicImport<{
    default?: typeof nodemailer
    createTransport?: (options?: unknown) => {
      sendMail: (params: unknown) => Promise<unknown>
    }
  }>('nodemailer')
  return mod.createTransport ? mod : (mod.default ?? mod)
})

const getTransporter = memoize(async (config: SMTPConfig) => {
  const nm = await getNodemailer()
  return nm.createTransport!(config as SMTPTransport.Options)
})

export async function sendSMTPMail(
  message: Message,
  config: SMTPConfig
): Promise<void> {
  const transporter = await getTransporter(config)
  await transporter.sendMail({
    from: getAddressFromEmail(message.from),
    to: message.to.map((email) => getAddressFromEmail(email)).join(', '),
    ...(message.replyTo
      ? { replyTo: getAddressFromEmail(message.replyTo) }
      : null),
    subject: message.subject,
    text: message.content.text,
    html: message.content.html
  })
}
