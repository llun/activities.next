import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { getMastodonList } from '@/lib/services/mastodon/getMastodonList'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// https://docs.joinmastodon.org/methods/accounts/#lists
export const GET = traceApiRoute(
  'getAccountLists',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:lists']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const lists = await database.getListsWithAccount({
        actorId: currentActor.id,
        targetActorId: idToUrl(id)
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: lists.map(getMastodonList)
      })
    }
  )
)
