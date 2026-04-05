import { getConfig } from '@/lib/config'
import { apiErrorResponse, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute('getVapidKey', async (req) => {
  const config = getConfig()
  if (!config.push) {
    return apiErrorResponse(404)
  }

  return apiResponse({
    req,
    allowedMethods: ['GET'],
    data: { vapidPublicKey: config.push.vapidPublicKey }
  })
})
