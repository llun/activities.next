import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import { z } from 'zod'

import { getConfig } from '@/lib/config'

import { getAddressFromEmail } from './smtp'
import { BaseEmailSettings, Message } from './types'

export const TYPE_SES = 'ses'

export const SESConfig = BaseEmailSettings.extend({
  type: z.literal(TYPE_SES),
  region: z.string()
})
export type SESConfig = z.infer<typeof SESConfig>

export async function sendSESMail(message: Message) {
  const config = getConfig()
  if (!config.email) return
  if (config.email.type !== TYPE_SES) return

  const client = new SESClient({ region: config.email.region })
  const command = new SendEmailCommand({
    Source: getAddressFromEmail(message.from),
    Destination: {
      ToAddresses: message.to.map((email) => getAddressFromEmail(email))
    },
    ...(message.replyTo
      ? { ReplyToAddresses: [getAddressFromEmail(message.replyTo)] }
      : {}),
    Message: {
      Subject: { Data: message.subject },
      Body: {
        Text: { Data: message.content.text },
        Html: { Data: message.content.html }
      }
    }
  })
  await client.send(command)
}
