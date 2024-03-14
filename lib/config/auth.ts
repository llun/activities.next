import { z } from 'zod'

import { matcher } from './utils'

const GithubConfig = z.object({
  id: z.string(),
  secret: z.string()
})
type GithubConfig = z.infer<typeof GithubConfig>

export const AuthConfig = z.object({
  enableStorageAdapter: z.boolean(),
  github: GithubConfig.nullish()
})
export type AuthConfig = z.infer<typeof AuthConfig>

const getGithubConfig = (): GithubConfig | null => {
  const hasEnvironmentAuthGithub = matcher('ACTIVITIES_AUTH_GITHUB_')
  if (!hasEnvironmentAuthGithub) return null

  return {
    id: process.env.ACTIVITIES_AUTH_GITHUB_ID as string,
    secret: process.env.ACTIVITIES_AUTH_GITHUB_SECRET as string
  }
}

export const getAuthConfig = (): { auth: AuthConfig } | null => {
  if (process.env.ACTIVITIES_AUTH) {
    return { auth: JSON.parse(process.env.ACTIVITIES_AUTH) }
  }

  const hasEnvironmentAuth = matcher('ACTIVITIES_AUTH_')
  if (!hasEnvironmentAuth) return null
  return {
    auth: {
      enableStorageAdapter: Boolean(
        process.env.ACTIVITIES_AUTH_ENABLE_STORAGE_ADAPTER
      ),
      github: getGithubConfig()
    }
  }
}
