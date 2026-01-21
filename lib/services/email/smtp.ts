import memoize from 'lodash/memoize'
import nodemailer from 'nodemailer'
import SMTPTransport from 'nodemailer/lib/smtp-transport'
import { z } from 'zod'

import { BaseEmailSettings, Email, Message } from './types'

export const TYPE_SMTP = 'smtp'

export const SMTPConfig = z.looseObject({
  ...BaseEmailSettings.shape,
  type: z.literal(TYPE_SMTP)
})
export type SMTPConfig = z.infer<typeof SMTPConfig> & SMTPTransport.Options

// Memoize transporter creation to reuse connections
// Use JSON stringification as the resolver to ensure same configs reuse transporters
const getTransporter = memoize(
  (emailConfig: SMTPConfig) => {
    return nodemailer.createTransport(emailConfig as SMTPTransport.Options)
  },
  (emailConfig: SMTPConfig) => JSON.stringify(emailConfig)
)

export const getAddressFromEmail = (email: Email) =>
  typeof email === 'string' ? email : `"${email.name}" <${email.email}>`

export async function sendSMTPMail(message: Message, emailConfig: SMTPConfig) {
  const transporter = getTransporter(emailConfig)
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
