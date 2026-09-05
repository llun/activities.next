import { SpanStatusCode, trace } from '@opentelemetry/api'
import type { Receiver } from '@upstash/qstash'
import { memoize } from 'lodash'
import { NextRequest } from 'next/server'

import { Config, getConfig } from '@/lib/config'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getQueue } from '@/lib/services/queue'
import { dynamicImport } from '@/lib/utils/dynamicImport'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { apiErrorResponse, apiResponse } from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const getReceiver = memoize(async (config: Config): Promise<Receiver> => {
  const { Receiver: QStashReceiver } = await dynamicImport<{
    Receiver: typeof Receiver
  }>('@upstash/qstash')
  return new QStashReceiver({
    currentSigningKey:
      config.queue?.type === 'qstash' ? config.queue.currentSigningKey : '',
    nextSigningKey:
      config.queue?.type === 'qstash' ? config.queue.nextSigningKey : ''
  })
})

export const POST = traceApiRoute(
  'processQueueJob',
  async (request: NextRequest) => {
    const config = getConfig()
    if (config.queue?.type !== 'qstash') {
      return apiErrorResponse(404)
    }

    const receiver = await getReceiver(config)
    const body = await request.text()
    const signature = request.headers.get('upstash-signature') ?? ''

    const isValid = await receiver.verify({
      body,
      signature,
      url: `https://${headerHost(request.headers)}/api/v1/queue/qstash`
    })
    if (!isValid) {
      return apiErrorResponse(400)
    }

    let jsonBody: unknown
    try {
      jsonBody = JSON.parse(body)
    } catch {
      return apiResponse({
        req: request,
        allowedMethods: [HttpMethod.enum.POST],
        data: { error: 'Invalid JSON payload' },
        responseStatusCode: 400
      })
    }

    const retriedHeader = request.headers.get('upstash-retried')
    const retriedCount = retriedHeader ? parseInt(retriedHeader, 10) : 0
    const maxRetries = config.queue.maxRetries ?? 3

    try {
      logger.debug(
        { body: jsonBody, retriedCount },
        'Received message from qstash'
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getQueue().handle(jsonBody as any)
    } catch (e) {
      const span = trace.getActiveSpan()
      const err = toLoggableError(e)
      span?.recordException(err)
      span?.setStatus({
        code: SpanStatusCode.ERROR,
        message: err.message
      })

      if (retriedCount < maxRetries) {
        logger.warn({
          err,
          retriedCount,
          message: 'Failed to process qstash message, returning 500 for retry'
        })
      } else {
        logger.error({
          err,
          retriedCount,
          message:
            'QStash job failed terminally, returning 500 for native DLQ capture'
        })
      }

      return apiResponse({
        req: request,
        allowedMethods: [HttpMethod.enum.POST],
        data: {
          error: err.message,
          stack: err.stack ?? null
        },
        responseStatusCode: 500
      })
    }

    return apiResponse({
      req: request,
      allowedMethods: [HttpMethod.enum.POST],
      data: {}
    })
  }
)
