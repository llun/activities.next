import { z } from 'zod'

export const AuthConfig = z.object({
  enableCredential: z.boolean().optional()
})
export type AuthConfig = z.infer<typeof AuthConfig>

export const getAuthConfig = (): { auth: AuthConfig } | null => {
  if (process.env.ACTIVITIES_AUTH) {
    return { auth: AuthConfig.parse(JSON.parse(process.env.ACTIVITIES_AUTH)) }
  }

  return null
}
