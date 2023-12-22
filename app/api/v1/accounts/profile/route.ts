import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'

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
type ProfileRequest = z.infer<typeof ProfileRequest>

export const POST = AuthenticatedGuard(async (req, context) => {
  const { currentActor, storage } = context
  const body = await req.json()
  await storage.updateActor({
    actorId: currentActor.id,
    ...ProfileRequest.parse(body)
  })
  return Response.redirect('/settings', 307)
})
