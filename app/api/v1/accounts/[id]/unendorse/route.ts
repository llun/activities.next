import {
  ENDORSEMENT_CORS_HEADERS,
  unendorseAccountHandler
} from '@/lib/services/accounts/endorsementHandlers'
import { defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

// POST /api/v1/accounts/:id/unendorse — Mastodon 4.4 alias for unpin.
// https://docs.joinmastodon.org/methods/accounts/#unendorse
export const OPTIONS = defaultOptions(ENDORSEMENT_CORS_HEADERS)

export const POST = traceApiRoute('unendorseAccount', unendorseAccountHandler, {
  addAttributes: async (_req, context) => {
    const params = await context.params
    return { accountId: params?.id || 'unknown' }
  }
})
