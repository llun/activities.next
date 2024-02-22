import { apiErrorResponse } from '@/lib/response'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'

interface Params {
  id: string
}

export const GET = AuthenticatedGuard<Params>(async (req, context, params) => {
  const uuid = params?.params.id
  if (!uuid) return apiErrorResponse(400)

  const { currentActor, storage } = context
  const statusId = `${currentActor.id}/statuses/${uuid}`
  const actors = await storage.getFavouritedBy({ statusId })
  return Response.json(actors.map((actor) => actor.toMastodonModel()))
})
