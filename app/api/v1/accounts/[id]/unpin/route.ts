import {
  ENDORSEMENT_CORS_HEADERS,
  unendorseAccountHandler
} from '@/lib/services/accounts/endorsementHandlers'
import { defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const OPTIONS = defaultOptions(ENDORSEMENT_CORS_HEADERS)

// POST /api/v1/accounts/:id/unpin — stop featuring (unendorse) an account.
// https://docs.joinmastodon.org/methods/accounts/#unpin
export const POST = traceApiRoute('unpinAccount', unendorseAccountHandler, {
  addAttributes: async (_req, context) => {
    const params = await context.params
    return { accountId: params?.id || 'unknown' }
  }
})
