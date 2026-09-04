import { SpanStatusCode, trace } from '@opentelemetry/api'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { CloudTasksConfig } from '@/lib/config/queue'
import { getDatabase } from '@/lib/database'
import { getQueue } from '@/lib/services/queue'
import { JobMessage } from '@/lib/services/queue/type'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { apiErrorResponse, apiResponse } from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const GOOGLE_CERTS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs')
let googleJWKS: ReturnType<typeof createRemoteJWKSet> | null = null

const getGoogleJWKS = () => {
  if (!googleJWKS) {
    googleJWKS = createRemoteJWKSet(GOOGLE_CERTS_URL)
  }
  return googleJWKS
}

export const verifyCloudTasksAuth = async (
  request: NextRequest,
  config?: CloudTasksConfig
): Promise<boolean> => {
  if (!config?.serviceAccount && !config?.audience && !config?.secret) {
    return true
  }

  const authHeader = request.headers.get('authorization') ?? ''
  const secretHeader =
    request.headers.get('x-cloudtasks-secret') ||
    request.headers.get('x-cloudtasks-token')

  if (config.secret) {
    if (
      authHeader === `Bearer ${config.secret}` ||
      secretHeader === config.secret
    ) {
      return true
    }
  }

  const serviceAccountHeader =
    request.headers.get('x-service-account') ||
    request.headers.get('x-cloudtasks-serviceaccount')

  if (config.serviceAccount && serviceAccountHeader === config.serviceAccount) {
    return true
  }

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim()
    try {
      const { payload } = await jwtVerify(token, getGoogleJWKS(), {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        ...(config.audience ? { audience: config.audience } : {})
      })

      if (config.serviceAccount && payload.email !== config.serviceAccount) {
        return false
      }

      return true
    } catch {
      return false
    }
  }

  return false
}

export const POST = traceApiRoute(
  'processCloudTasksJob',
  async (request: NextRequest) => {
    const config = getConfig()
    if (config.queue && config.queue.type !== 'cloudtasks') {
      return apiErrorResponse(404)
    }

    const cloudTasksConfig =
      config.queue?.type === 'cloudtasks' ? config.queue : undefined

    const isAuthorized = await verifyCloudTasksAuth(request, cloudTasksConfig)
    if (!isAuthorized) {
      return apiResponse({
        req: request,
        allowedMethods: [HttpMethod.enum.POST],
        data: { error: 'Unauthorized' },
        responseStatusCode: 401
      })
    }

    const rawBody = await request.text()
    let jobMessage: JobMessage
    try {
      jobMessage = JSON.parse(rawBody)
    } catch {
      return apiResponse({
        req: request,
        allowedMethods: [HttpMethod.enum.POST],
        data: { error: 'Invalid JSON payload' },
        responseStatusCode: 400
      })
    }

    if (!jobMessage || typeof jobMessage !== 'object' || !jobMessage.name) {
      return apiResponse({
        req: request,
        allowedMethods: [HttpMethod.enum.POST],
        data: { error: 'Missing job name in payload' },
        responseStatusCode: 400
      })
    }

    const retryCountHeader = request.headers.get('x-cloudtasks-taskretrycount')
    const executionCountHeader = request.headers.get(
      'x-cloudtasks-taskexecutioncount'
    )
    const retryCount = retryCountHeader ? parseInt(retryCountHeader, 10) : 0
    const executionCount = executionCountHeader
      ? parseInt(executionCountHeader, 10)
      : 0
    const maxRetries = cloudTasksConfig?.maxRetries ?? 5

    try {
      logger.debug(
        { job: jobMessage, retryCount, executionCount },
        'Handling Cloud Tasks queue job'
      )
      await getQueue().handle(jobMessage)
    } catch (e) {
      const span = trace.getActiveSpan()
      const err = toLoggableError(e)
      span?.recordException(err)
      span?.setStatus({
        code: SpanStatusCode.ERROR,
        message: err.message
      })

      if (retryCount < maxRetries - 1) {
        logger.warn({
          err,
          retryCount,
          executionCount,
          message: 'Cloud Tasks job execution failed, returning 500 for retry'
        })
        return apiResponse({
          req: request,
          allowedMethods: [HttpMethod.enum.POST],
          data: { error: err.message || 'Job execution failed' },
          responseStatusCode: 500
        })
      }

      logger.error({
        err,
        retryCount,
        executionCount,
        message:
          'Cloud Tasks job failed terminally, capturing in dead letter queue'
      })

      const database = getDatabase()
      if (database) {
        await database.createDeadLetterJob({
          jobName: String(jobMessage.name),
          payload: jobMessage,
          errorMessage: err.message || 'Job execution failed terminally',
          errorStack: err.stack ?? null,
          attempts: retryCount + 1,
          status: 'failed'
        })
      }

      return apiResponse({
        req: request,
        allowedMethods: [HttpMethod.enum.POST],
        data: { status: 'OK' }
      })
    }

    return apiResponse({
      req: request,
      allowedMethods: [HttpMethod.enum.POST],
      data: {}
    })
  }
)
