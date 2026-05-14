import { z } from 'zod'

import { matcher } from './utils'

const DEFAULT_RESPONSE_TIMEOUT = 4000
const DEFAULT_MAX_RETRY_LIMIT = 1
const DEFAULT_MAX_RESPONSE_SIZE_IN_BYTES = 2 * 1024 * 1024

export const RequestConfig = z.object({
  timeoutInMilliseconds: z
    .number()
    .positive()
    .safe()
    .default(DEFAULT_RESPONSE_TIMEOUT),
  numberOfRetry: z.number().positive().safe().default(DEFAULT_MAX_RETRY_LIMIT),
  retryNoise: z
    .number()
    .min(-100)
    .max(100)
    .nullish()
    .describe('retry noise that add to backoff delay'),
  maxResponseSizeInBytes: z
    .number()
    .positive()
    .safe()
    .default(DEFAULT_MAX_RESPONSE_SIZE_IN_BYTES)
})
export type RequestConfig = z.infer<typeof RequestConfig>

const getOptionalInteger = (key: string) => {
  const value = process.env[key]
  if (typeof value === 'undefined' || value === '') return undefined
  return parseInt(value, 10)
}

export const getRequestConfig = (): { request: RequestConfig } | null => {
  const hasEnvironmentRedis = matcher('ACTIVITIES_REQUEST_')
  if (!hasEnvironmentRedis) return null
  return {
    request: RequestConfig.parse({
      timeoutInMilliseconds: getOptionalInteger('ACTIVITIES_REQUEST_TIMEOUT'),
      numberOfRetry: getOptionalInteger('ACTIVITIES_REQUEST_RETRY'),
      retryNoise: getOptionalInteger('ACTIVITIES_REQUEST_RETRY_NOISE'),
      maxResponseSizeInBytes: getOptionalInteger(
        'ACTIVITIES_REQUEST_MAX_RESPONSE_SIZE_BYTES'
      )
    })
  }
}
