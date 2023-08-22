import memoize from 'lodash/memoize'
import nodemailer from 'nodemailer'
import SMTPTransport from 'nodemailer/lib/smtp-transport'

import { Email, Message } from '.'
import { getConfig } from '../../config'

const TYPE_SMTP = 'smtp'

export interface SMTPConfig extends SMTPTransport.Options {
  type: typeof TYPE_SMTP
}

const getTransporter = memoize(() => {
  const { email } = getConfig()
  if (!email || email.type !== TYPE_SMTP) return null

  return nodemailer.createTransport(email)
})

const getAddressFromEmail = (email: Email) =>
  typeof email === 'string' ? email : `"${email.name}" <${email.email}>`

export async function sendMail(message: Message) {
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
