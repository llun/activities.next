import { Receiver } from '@upstash/qstash'
import { memoize } from 'lodash'
import { NextRequest } from 'next/server'

import { Config, getConfig } from '@/lib/config'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getQueue } from '@/lib/services/queue'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { logger } from '@/lib/utils/logger'
import { apiErrorResponse, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const getReceiver = memoize(
  (config: Config) =>
    new Receiver({
      currentSigningKey: config.queue?.currentSigningKey || '',
      nextSigningKey: config.queue?.nextSigningKey || ''
    })
)

export const POST = traceApiRoute(
  'processQueueJob',
  async (request: NextRequest) => {
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

      const jsonBody = JSON.parse(body)
      logger.debug({ body: jsonBody }, 'Received message from qstash')
      await getQueue().handle(jsonBody)
    } catch (e) {
      logger.error(e)
      return apiErrorResponse(400)
    }
    return apiResponse({
      req: request,
      allowedMethods: [HttpMethod.enum.POST],
      data: {}
    })
  }
)
