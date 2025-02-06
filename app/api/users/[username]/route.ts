import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'

export const GET = OnlyLocalUserGuard(async (_, actor, req) => {
  const acceptHeader = req.headers.get('accept')
  if (acceptHeader?.startsWith('application/ld+json')) {
    return Response.json(getPersonFromActor(actor), {
      headers: { 'content-type': 'application/ld+json' }
    })
  }

  if (acceptHeader?.startsWith('application/activity+json')) {
    return Response.json(getPersonFromActor(actor), {
      headers: { 'content-type': 'application/activity+json' }
    })
  }

  return Response.redirect(`https://${actor.domain}/@${actor.username}`)
})
