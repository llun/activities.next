import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import memoize from 'lodash/memoize'
import { z } from 'zod'

import { getConfig } from '@/lib/config'

import { getAddressFromEmail } from './smtp'
import { BaseEmailSettings, Message } from './types'

export const TYPE_SES = 'ses'

export const SESConfig = BaseEmailSettings.extend({
  type: z.literal(TYPE_SES),
  region: z.string().optional()
})
export type SESConfig = z.infer<typeof SESConfig>

const getSESClient = memoize(
  (region: string | undefined) => new SESClient(region ? { region } : {})
)

export async function sendSESMail(message: Message) {
  const config = getConfig()
  if (!config.email) return
  if (config.email.type !== TYPE_SES) return

  const client = getSESClient(config.email.region)
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
