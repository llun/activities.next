import { z } from 'zod'

import { matcher } from './utils'

export const RedisConfig = z.object({
  url: z.string(),
  tls: z.boolean().optional()
})
export type RedisConfig = z.infer<typeof RedisConfig>

export const getRedisConfig = (): { redis: RedisConfig } | null => {
  const hasEnvironmentRedis = matcher('ACTIVITIES_REDIS_')
  if (!hasEnvironmentRedis) return null
  return {
    redis: {
      url: process.env.ACTIVITIES_REDIS_URL as string,
      tls: Boolean(process.env.ACTIVITIES_REDIS_TLS)
    }
  }
}
