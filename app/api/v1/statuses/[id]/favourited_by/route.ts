import { Scope } from '@/lib/database/types/oauth'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonAccount } from '@/lib/services/mastodon/getMastodonAccount'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const GET = OAuthGuard<Params>(
  [Scope.enum.read],
  async (req, context, params) => {
    const uuid = (await params?.params).id
    if (!uuid) return apiErrorResponse(400)

    const { currentActor, database } = context
    const statusId = `${currentActor.id}/statuses/${uuid}`
    const actors = await database.getFavouritedBy({ statusId })
    return apiResponse(
      req,
      CORS_HEADERS,
      await Promise.all(
        actors.map((actor) => getMastodonAccount(database, actor.data))
      )
    )
  }
)
