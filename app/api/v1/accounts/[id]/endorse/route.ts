import {
  ENDORSEMENT_CORS_HEADERS,
  endorseAccountHandler
} from '@/lib/services/accounts/endorsementHandlers'
import { defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

// POST /api/v1/accounts/:id/endorse — Mastodon 4.4 alias for pin.
// https://docs.joinmastodon.org/methods/accounts/#endorse
export const OPTIONS = defaultOptions(ENDORSEMENT_CORS_HEADERS)

export const POST = traceApiRoute('endorseAccount', endorseAccountHandler, {
  addAttributes: async (_req, context) => {
    const params = await context.params
    return { accountId: params?.id || 'unknown' }
  }
})
