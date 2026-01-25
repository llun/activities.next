import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const EmailNotificationSettingsRequest = z.object({
  follow_request: z.string().optional(),
  follow: z.string().optional(),
  like: z.string().optional(),
  mention: z.string().optional(),
  reply: z.string().optional(),
  reblog: z.string().optional(),
  actorId: z.string().optional()
})

export const POST = traceApiRoute(
  'updateEmailNotifications',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    const body = await req.formData()
    const json = Object.fromEntries(body.entries())

    const parsed = EmailNotificationSettingsRequest.parse(json)

    // Extract the actorId from the form data, default to currentActor.id
    const targetActorId = parsed.actorId || currentActor.id

    // Verify the user has access to this actor
    if (currentActor.account) {
      const actors = await database.getActorsForAccount({
        accountId: currentActor.account.id
      })
      const hasAccess = actors.some((actor) => actor.id === targetActorId)
      if (!hasAccess) {
        return Response.json({ error: 'Unauthorized' }, { status: 403 })
      }
    }

    // Convert checkbox values to booleans
    // - If value is 'on', it's checked -> true
    // - If missing but marker is present, it's unchecked -> false
    const emailNotifications = {
      follow_request:
        parsed.follow_request === 'on'
          ? true
          : json.follow_request_marker === 'true'
            ? false
            : undefined,
      follow:
        parsed.follow === 'on'
          ? true
          : json.follow_marker === 'true'
            ? false
            : undefined,
      like:
        parsed.like === 'on'
          ? true
          : json.like_marker === 'true'
            ? false
            : undefined,
      mention:
        parsed.mention === 'on'
          ? true
          : json.mention_marker === 'true'
            ? false
            : undefined,
      reply:
        parsed.reply === 'on'
          ? true
          : json.reply_marker === 'true'
            ? false
            : undefined,
      reblog:
        parsed.reblog === 'on'
          ? true
          : json.reblog_marker === 'true'
            ? false
            : undefined
    }

    // Filter out undefined values
    const filteredNotifications = Object.fromEntries(
      Object.entries(emailNotifications).filter(([_, v]) => v !== undefined)
    )

    await database.updateActor({
      actorId: targetActorId,
      emailNotifications: filteredNotifications as {
        follow_request?: boolean
        follow?: boolean
        like?: boolean
        mention?: boolean
        reply?: boolean
        reblog?: boolean
      }
    })

    const host = headerHost(req.headers)
    const url = new URL('/settings/notifications', `https://${host}`)
    return Response.redirect(url.toString(), 307)
  })
)
