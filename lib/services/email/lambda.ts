import {
  InvocationType,
  InvokeCommand,
  LambdaClient
} from '@aws-sdk/client-lambda'
import { fromUtf8 } from '@aws-sdk/util-utf8-node'

import { getConfig } from '../../config'
import { Message } from './index'

export async function sendMail(message: Message) {
  const config = getConfig()
  if (!config.aws) return
  if (!config.aws.functions.sendMail) return

  const client = new LambdaClient({
    region: config.aws.region
  })
  const command = new InvokeCommand({
    FunctionName: config.aws.functions.sendMail.name,
    Qualifier: config.aws.functions.sendMail.qualifier,
    InvocationType: InvocationType.Event,
    Payload: fromUtf8(JSON.stringify(message))
  })
  await client.send(command)
}
