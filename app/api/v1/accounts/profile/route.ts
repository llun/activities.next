import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { parseProfileImageUrl } from '@/lib/services/accounts/profileImageUrl'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import {
  POST_LINE_LIMIT_VALUES,
  PostLineLimit
} from '@/lib/types/database/rows'
import { HTTP_STATUS, apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

// The settings form's own fields, and nothing else. `publicKey`,
// `followersUrl`, `inboxUrl` and `sharedInboxUrl` were accepted here as free
// strings and passed straight to `updateActor`, which persists all four — so
// any signed-in user could rewrite the public key and inbox endpoints their own
// actor publishes. No form has ever sent them; Zod strips them as unknown keys.
const ProfileRequest = z.object({
  name: z.string().optional(),
  summary: z.string().optional(),
  iconUrl: z.string().optional(),
  headerImageUrl: z.string().optional(),
  manuallyApprovesFollowers: z.string().optional(),
  postLineLimit: z.string().optional()
})

export const POST = traceApiRoute(
  'updateProfile',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    const body = await req.formData()
    const json = Object.fromEntries(body.entries())

    const parsed = ProfileRequest.safeParse(json)
    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }
    // Handle checkbox behavior:
    // 1. If 'on', it's checked -> true
    // 2. If missing but marker is present, it's unchecked -> false
    // 3. If missing and marker is missing, it's a partial update -> undefined (don't update)

    // Extract raw value to avoid passing string "on" to updateActor which expects boolean
    const {
      manuallyApprovesFollowers: rawValue,
      postLineLimit: rawPostLineLimit,
      iconUrl: rawIconUrl,
      headerImageUrl: rawHeaderImageUrl,
      ...safeParsed
    } = parsed.data

    // Only a URL naming media this instance already stores. The form always
    // submits both fields, so an empty one is the user clearing the image
    // rather than a partial update — `parseProfileImageUrl` answers null for it
    // and `updateActor` reads that as an explicit clear.
    // The actor's stored values are passed so a form resubmitting one it did
    // not change is treated as "no change" rather than re-validated — see
    // `parseProfileImageUrl`, where the single settings form makes that
    // load-bearing.
    const config = getConfig()
    const iconUrl = parseProfileImageUrl(
      rawIconUrl,
      config,
      currentActor.iconUrl
    )
    const headerImageUrl = parseProfileImageUrl(
      rawHeaderImageUrl,
      config,
      currentActor.headerImageUrl
    )
    if (!iconUrl.valid || !headerImageUrl.valid) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    let manuallyApprovesFollowers: boolean | undefined
    if (rawValue === 'on') {
      manuallyApprovesFollowers = true
    } else if (json.manuallyApprovesFollowers_marker === 'true') {
      manuallyApprovesFollowers = false
    }

    let postLineLimit: PostLineLimit | undefined
    if (rawPostLineLimit !== undefined && rawPostLineLimit !== '') {
      const numValue = parseInt(rawPostLineLimit, 10)
      if (
        !isNaN(numValue) &&
        POST_LINE_LIMIT_VALUES.includes(numValue as PostLineLimit)
      ) {
        postLineLimit = numValue as PostLineLimit
      }
    }

    await database.updateActor({
      actorId: currentActor.id,
      ...safeParsed,
      ...(iconUrl.value !== undefined ? { iconUrl: iconUrl.value } : null),
      ...(headerImageUrl.value !== undefined
        ? { headerImageUrl: headerImageUrl.value }
        : null),
      ...(manuallyApprovesFollowers !== undefined
        ? { manuallyApprovesFollowers }
        : null),
      ...(postLineLimit !== undefined ? { postLineLimit } : null)
    })

    const host = headerHost(req.headers)
    const url = new URL('/settings', `https://${host}`)
    return Response.redirect(url.toString(), 307)
  })
)
