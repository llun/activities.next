import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const UpdateNameRequest = z.object({
  name: z
    .string()
    .trim()
    .max(255)
    .transform((v) => v || null)
})

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'updateAccountName',
  AuthenticatedGuard(async (req, context) => {
    const { database } = context
    const account = context.currentActor.account!

    let json: unknown
    try {
      json = await req.json()
    } catch {
      return apiErrorResponse(400)
    }

    const parsed = UpdateNameRequest.safeParse(json)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Invalid name' },
        responseStatusCode: 422
      })
    }

    await database.updateAccountName({
      accountId: account.id,
      name: parsed.data.name
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { success: true }
    })
  })
)
