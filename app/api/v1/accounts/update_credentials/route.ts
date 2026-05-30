import { z } from 'zod'

import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

// Tier 1 scope: text fields only. Avatar/header file uploads are accepted but
// ignored here; wiring them through the media-storage pipeline is a follow-up.
const UpdateCredentialsRequest = z.object({
  display_name: z.string().max(255).optional(),
  note: z.string().optional(),
  locked: z.string().optional()
})

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.PATCH]

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

const parseBoolean = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return undefined
}

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const PATCH = traceApiRoute(
  'updateCredentials',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:accounts']],
    async (req, context) => {
      const { currentActor, database } = context

      let fields: Record<string, string>
      try {
        const form = await req.formData()
        fields = Object.fromEntries(
          Array.from(form.entries())
            .filter(([, value]) => typeof value === 'string')
            .map(([key, value]) => [key, value as string])
        )
      } catch {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Invalid request body' },
          responseStatusCode: 400
        })
      }

      const parsed = UpdateCredentialsRequest.safeParse(fields)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Invalid input' },
          responseStatusCode: 422
        })
      }

      const { display_name, note, locked } = parsed.data
      const manuallyApprovesFollowers = parseBoolean(locked)

      await database.updateActor({
        actorId: currentActor.id,
        ...(display_name !== undefined ? { name: display_name } : null),
        ...(note !== undefined ? { summary: note } : null),
        ...(manuallyApprovesFollowers !== undefined
          ? { manuallyApprovesFollowers }
          : null)
      })

      const actor = await database.getMastodonActorFromId({
        id: currentActor.id
      })
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: actor })
    },
    guardOptions
  )
)
