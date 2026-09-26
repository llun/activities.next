import type {
  SESClient as SESClientType,
  SendEmailCommand as SendEmailCommandType
} from '@aws-sdk/client-ses'
import memoize from 'lodash/memoize'

import type { Message, SESConfig } from '@/lib/config/email'
import { dynamicImport } from '@/lib/utils/dynamicImport'

import { getAddressFromEmail } from './address'

const getSESModule = memoize(async () => {
  return await dynamicImport<{
    SESClient: typeof SESClientType
    SendEmailCommand: typeof SendEmailCommandType
  }>('@aws-sdk/client-ses')
})

const getSESClient = memoize(async (region: string | undefined) => {
  const { SESClient } = await getSESModule()
  return new SESClient(region ? { region } : {})
})

export async function sendSESMail(
  message: Message,
  config: SESConfig
): Promise<void> {
  const [{ SendEmailCommand }, client] = await Promise.all([
    getSESModule(),
    getSESClient(config.region)
  ])
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
