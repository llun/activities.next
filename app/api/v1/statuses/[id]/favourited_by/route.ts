import { apiErrorResponse, apiResponse, defaultOptions } from '@/lib/response'
import { getMastodonActor } from '@/lib/services/actors/getMastodonActor'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/storage/types/oauth'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const GET = OAuthGuard<Params>(
  [Scope.enum.read],
  async (req, context, params) => {
    const uuid = params?.params.id
    if (!uuid) return apiErrorResponse(400)

    const { currentActor, storage } = context
    const statusId = `${currentActor.id}/statuses/${uuid}`
    const actors = await storage.getFavouritedBy({ statusId })
    return apiResponse(
      req,
      CORS_HEADERS,
      await Promise.all(
        actors.map((actor) => getMastodonActor(storage, actor.data))
      )
    )
  }
)
