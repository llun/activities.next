import {
  InvocationType,
  InvokeCommand,
  LambdaClient
} from '@aws-sdk/client-lambda'
import { fromUtf8 } from '@aws-sdk/util-utf8-node'

import { getConfig } from '../../config'
import { BaseEmailSettings, Message } from './types'

export const TYPE_LAMBDA = 'lambda'

export interface LambdaConfig extends BaseEmailSettings {
  type: typeof TYPE_LAMBDA
  region: string
  functionName: string
  functionQualifier: string
}

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
