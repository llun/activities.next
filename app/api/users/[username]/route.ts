import { OnlyLocalUserGuard } from './guard'

export const GET = OnlyLocalUserGuard(async (_, actor) => {
  return Response.json(actor.toPerson())
})
