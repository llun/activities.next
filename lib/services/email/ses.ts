import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import memoize from 'lodash/memoize'

import type { Message, SESConfig } from '@/lib/config/email'

import { getAddressFromEmail } from './address'

const getSESClient = memoize(
  (region: string | undefined) => new SESClient(region ? { region } : {})
)

export async function sendSESMail(
  message: Message,
  config: SESConfig
): Promise<void> {
  const client = getSESClient(config.region)
  const command = new SendEmailCommand({
    Source: getAddressFromEmail(message.from),
    Destination: {
      ToAddresses: message.to.map((email) => getAddressFromEmail(email))
    },
    ...(message.replyTo
      ? { ReplyToAddresses: [getAddressFromEmail(message.replyTo)] }
      : {}),
    Message: {
      Subject: { Data: message.subject, Charset: 'UTF-8' },
      Body: {
        Text: { Data: message.content.text, Charset: 'UTF-8' },
        Html: { Data: message.content.html, Charset: 'UTF-8' }
      }
    }
  })
  await client.send(command)
}
