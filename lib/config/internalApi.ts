import { z } from 'zod'

import { matcher } from './utils'

export const InternalApiConfig = z.object({
  sharedKey: z.string()
})
export type InternalApiConfig = z.infer<typeof InternalApiConfig>

export const getInternalApiConfig = (): {
  internalApi: InternalApiConfig
} | null => {
  const hasEnvironmentInternalApi = matcher('ACTIVITIES_INTERNAL_API_')
  if (!hasEnvironmentInternalApi) return null
  return {
    internalApi: {
      sharedKey: process.env.ACTIVITIES_INTERNAL_SHARED_KEY as string
    }
  }
}
