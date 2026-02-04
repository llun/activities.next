import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const ProfileRequest = z.object({
  name: z.string().optional(),
  summary: z.string().optional(),
  iconUrl: z.string().optional(),
  headerImageUrl: z.string().optional(),
  manuallyApprovesFollowers: z.string().optional(),

  publicKey: z.string().optional(),

  followersUrl: z.string().optional(),
  inboxUrl: z.string().optional(),
  sharedInboxUrl: z.string().optional()
})

export const POST = traceApiRoute(
  'updateProfile',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    const body = await req.formData()
    const json = Object.fromEntries(body.entries())

    const parsed = ProfileRequest.parse(json)
    // Handle checkbox behavior:
    // 1. If 'on', it's checked -> true
    // 2. If missing but marker is present, it's unchecked -> false
    // 3. If missing and marker is missing, it's a partial update -> undefined (don't update)

    // Extract raw value to avoid passing string "on" to updateActor which expects boolean
    const { manuallyApprovesFollowers: rawValue, ...safeParsed } = parsed

    let manuallyApprovesFollowers: boolean | undefined
    if (rawValue === 'on') {
      manuallyApprovesFollowers = true
    } else if (json.manuallyApprovesFollowers_marker === 'true') {
      manuallyApprovesFollowers = false
    }

    await database.updateActor({
      actorId: currentActor.id,
      ...safeParsed,
      ...(manuallyApprovesFollowers !== undefined
        ? { manuallyApprovesFollowers }
        : null)
    })

    const host = headerHost(req.headers)
    const url = new URL('/settings', `https://${host}`)
    return Response.redirect(url.toString(), 307)
  })
)
