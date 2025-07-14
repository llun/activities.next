import { z } from 'zod'

import { matcher } from './utils'

const DEFAULT_RESPONSE_TIMEOUT = 4000
const DEFAULT_MAX_RETRY_LIMIT = 1

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
    .describe('retry noise that add to backoff delay')
})
export type RequestConfig = z.infer<typeof RequestConfig>

export const getRequestConfig = (): { request: RequestConfig } | null => {
  const hasEnvironmentRedis = matcher('ACTIVITIES_REQUEST_')
  if (!hasEnvironmentRedis) return null
  return {
    request: {
      timeoutInMilliseconds: parseInt(
        process.env.ACTIVITIES_REQUEST_TIMEOUT as string,
        10
      ),
      numberOfRetry: parseInt(
        process.env.ACTIVITIES_REQUEST_RETRY as string,
        10
      ),
      retryNoise: process.env.ACTIVITIES_REQUEST_RETRY_NOISE
        ? parseInt(process.env.ACTIVITIES_REQUEST_RETRY_NOISE, 10)
        : null
    }
  }
}
