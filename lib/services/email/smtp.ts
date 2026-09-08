import memoize from 'lodash/memoize'
import nodemailer from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'

import type { Message, SMTPConfig } from '@/lib/config/email'

import { getAddressFromEmail } from './address'

const getTransporter = memoize((config: SMTPConfig) =>
  nodemailer.createTransport(config as SMTPTransport.Options)
)

export async function sendSMTPMail(
  message: Message,
  config: SMTPConfig
): Promise<void> {
  const transporter = getTransporter(config)
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
