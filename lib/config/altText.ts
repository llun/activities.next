import { z } from 'zod'

import { logger } from '@/lib/utils/logger'

import { matcher } from './utils'

export const AltTextConfig = z.object({
  endpoint: z.string(),
  apiKey: z.string(),
  model: z.string()
})
export type AltTextConfig = z.infer<typeof AltTextConfig>

/**
 * The alt text vision endpoint, or null without all three variables.
 * `quiet` skips the "requires ..." warning for a caller that runs on every
 * request (the photo editor's capabilities), since `getConfig()` already logs
 * it once when the configuration loads.
 */
export const getAltTextConfig = ({ quiet = false }: { quiet?: boolean } = {}): {
  altText: AltTextConfig
} | null => {
  if (!matcher('ACTIVITIES_ALT_TEXT_')) return null

  const endpoint = process.env.ACTIVITIES_ALT_TEXT_ENDPOINT
  const apiKey = process.env.ACTIVITIES_ALT_TEXT_API_KEY
  const model = process.env.ACTIVITIES_ALT_TEXT_MODEL

  if (!endpoint || !apiKey || !model) {
    if (!quiet) {
      logger.warn({
        message:
          'Alt text generation requires ACTIVITIES_ALT_TEXT_ENDPOINT, ACTIVITIES_ALT_TEXT_API_KEY and ACTIVITIES_ALT_TEXT_MODEL; alt text generation will be disabled'
      })
    }
    return null
  }

  return {
    altText: {
      endpoint,
      apiKey,
      model
    }
  }
}
