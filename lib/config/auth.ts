import { z } from 'zod'

import { logger } from '@/lib/utils/logger'

export const AuthConfig = z.object({
  enableCredential: z.boolean().optional()
})
export type AuthConfig = z.infer<typeof AuthConfig>

export const getAuthConfig = (): { auth: AuthConfig } | null => {
  if (process.env.ACTIVITIES_AUTH) {
    let raw: unknown
    try {
      raw = JSON.parse(process.env.ACTIVITIES_AUTH)
    } catch {
      throw new Error('ACTIVITIES_AUTH is not valid JSON')
    }

    const result = AuthConfig.safeParse(raw)
    if (!result.success) {
      throw new Error(`ACTIVITIES_AUTH is invalid: ${result.error.message}`)
    }

    return { auth: result.data }
  }

  if (
    process.env.ACTIVITIES_AUTH_GITHUB_ID ||
    process.env.ACTIVITIES_AUTH_GITHUB_SECRET
  ) {
    logger.warn({
      message:
        'ACTIVITIES_AUTH_GITHUB_ID and ACTIVITIES_AUTH_GITHUB_SECRET are no longer supported and will be ignored. Remove them from your environment.'
    })
  }

  return null
}
