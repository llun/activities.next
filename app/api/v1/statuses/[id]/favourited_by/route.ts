import { ERROR_400 } from '@/lib/errors'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'

interface Params {
  id: string
}

export const GET = AuthenticatedGuard<Params>(async (req, context, params) => {
  const uuid = params?.params.id
  if (!uuid) {
    return Response.json(ERROR_400, { status: 400 })
  }

  const { currentActor, storage } = context
  const statusId = `${currentActor.id}/statuses/${uuid}`
  const actors = await storage.getFavouritedBy({ statusId })
  return Response.json(actors.map((actor) => actor.toMastodonModel()))
})
