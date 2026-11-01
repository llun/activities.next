import { z } from 'zod'

import {
  CLIENT_ERROR_MAX_LENGTHS,
  CLIENT_ERROR_SOURCES
} from '@/lib/utils/clientErrors/types'

export const ClientErrorSchema = z.strictObject({
  name: z.string().max(CLIENT_ERROR_MAX_LENGTHS.name).optional(),
  message: z.string().max(CLIENT_ERROR_MAX_LENGTHS.message),
  stack: z.string().max(CLIENT_ERROR_MAX_LENGTHS.stack).optional(),
  digest: z.string().max(CLIENT_ERROR_MAX_LENGTHS.digest).optional(),
  pathname: z.string().startsWith('/').max(CLIENT_ERROR_MAX_LENGTHS.pathname),
  userAgent: z.string().max(CLIENT_ERROR_MAX_LENGTHS.userAgent),
  buildVersion: z.string().max(CLIENT_ERROR_MAX_LENGTHS.buildVersion),
  source: z.enum(CLIENT_ERROR_SOURCES)
})

export type ClientErrorInput = z.infer<typeof ClientErrorSchema>
