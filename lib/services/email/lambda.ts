import {
  InvocationType,
  InvokeCommand,
  LambdaClient
} from '@aws-sdk/client-lambda'
import { fromUtf8 } from '@aws-sdk/util-utf8-node'
import { z } from 'zod'

import { BaseEmailSettings, Message } from './types'

export const TYPE_LAMBDA = 'lambda'

export const LambdaConfig = BaseEmailSettings.extend({
  type: z.literal(TYPE_LAMBDA),
  region: z.string(),
  functionName: z.string(),
  functionQualifier: z.string()
})
export type LambdaConfig = z.infer<typeof LambdaConfig>

export async function sendLambdaMail(message: Message, emailConfig: LambdaConfig) {
  const client = new LambdaClient({
    region: emailConfig.region
  })
  const command = new InvokeCommand({
    FunctionName: emailConfig.functionName,
    Qualifier: emailConfig.functionQualifier,
    InvocationType: InvocationType.Event,
    Payload: fromUtf8(JSON.stringify(message))
  })
  await client.send(command)
}
