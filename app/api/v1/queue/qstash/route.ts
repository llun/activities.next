import { Receiver } from '@upstash/qstash'
import { memoize } from 'lodash'
import { NextRequest } from 'next/server'

import { Config, getConfig } from '@/lib/config'
import { headerHost } from '@/lib/services/guards/headerHost'
import { apiErrorResponse, apiResponse } from '@/lib/utils/response'

const getReceiver = memoize(
  (config: Config) =>
    new Receiver({
      currentSigningKey: config.queue?.currentSigningKey || '',
      nextSigningKey: config.queue?.nextSigningKey || ''
    })
)

export const POST = async (request: NextRequest) => {
  const config = getConfig()
  if (config.queue?.type !== 'qstash') {
    return apiErrorResponse(404)
  }

  const receiver = getReceiver(config)
  const body = await request.text()
  const signature = request.headers.get('upstash-signature') ?? ''

  try {
    const isValid = await receiver.verify({
      body,
      signature,
      url: `https://${headerHost(request.headers)}/api/v1/queue/qstash`
    })
    if (!isValid) {
      return apiErrorResponse(400)
    }
  } catch {
    return apiErrorResponse(400)
  }
  return apiResponse(request, ['POST'], {})
}
