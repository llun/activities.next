import memoize from 'lodash/memoize'
import nodemailer from 'nodemailer'
import SMTPTransport from 'nodemailer/lib/smtp-transport'
import { z } from 'zod'

import { getConfig } from '../../config'
import { BaseEmailSettings, Email, Message } from './types'

export const TYPE_SMTP = 'smtp'

export const SMTPConfig = z.looseObject({
  ...BaseEmailSettings.shape,
  type: z.literal(TYPE_SMTP)
})
export type SMTPConfig = z.infer<typeof SMTPConfig> & SMTPTransport.Options

const getTransporter = memoize(() => {
  const { email } = getConfig()
  if (!email || email.type !== TYPE_SMTP) return null

  return nodemailer.createTransport(email as SMTPTransport.Options)
})

export const getAddressFromEmail = (email: Email) =>
  typeof email === 'string' ? email : `"${email.name}" <${email.email}>`

export async function sendSMTPMail(message: Message) {
  const transporter = getTransporter()
  if (!transporter) return
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
