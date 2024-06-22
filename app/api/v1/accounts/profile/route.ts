import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { headerHost } from '@/lib/services/guards/headerHost'

const ProfileRequest = z.object({
  name: z.string().optional(),
  summary: z.string().optional(),
  iconUrl: z.string().optional(),
  headerImageUrl: z.string().optional(),
  appleSharedAlbumToken: z.string().optional(),

  publicKey: z.string().optional(),

  followersUrl: z.string().optional(),
  inboxUrl: z.string().optional(),
  sharedInboxUrl: z.string().optional()
})

export const POST = AuthenticatedGuard(async (req, context) => {
  const { currentActor, storage } = context
  const body = await req.formData()
  const json = Object.fromEntries(body.entries())

  await storage.updateActor({
    actorId: currentActor.id,
    ...ProfileRequest.parse(json)
  })

  const host = headerHost(req.headers)
  const url = new URL('/settings', `https://${host}`)
  return Response.redirect(url.toString(), 307)
})
