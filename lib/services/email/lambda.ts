import {
  InvocationType,
  InvokeCommand,
  LambdaClient
} from '@aws-sdk/client-lambda'
import { fromUtf8 } from '@aws-sdk/util-utf8-node'
import { z } from 'zod'

import { getConfig } from '../../config'
import { BaseEmailSettings, Message } from './types'

export const TYPE_LAMBDA = 'lambda'

export const LambdaConfig = BaseEmailSettings.extend({
  type: z.literal(TYPE_LAMBDA),
  region: z.string(),
  functionName: z.string(),
  functionQualifier: z.string()
})
export type LambdaConfig = z.infer<typeof LambdaConfig>

export async function sendLambdaMail(message: Message) {
  const config = getConfig()
  if (!config.email) return
  if (config.email.type !== TYPE_LAMBDA) return

  const client = new LambdaClient({
    region: config.email.region
  })
  const command = new InvokeCommand({
    FunctionName: config.email.functionName,
    Qualifier: config.email.functionQualifier,
    InvocationType: InvocationType.Event,
    Payload: fromUtf8(JSON.stringify(message))
  })
  await client.send(command)
}
