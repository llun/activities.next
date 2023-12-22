import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'

export const GET = OnlyLocalUserGuard(async (_, actor) => {
  return Response.json(actor.toPerson())
})
