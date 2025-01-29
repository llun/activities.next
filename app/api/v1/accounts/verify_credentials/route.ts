import { Scope } from '@/lib/database/types/oauth'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonAccount } from '@/lib/services/mastodon/getMastodonAccount'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = OAuthGuard([Scope.enum.read], async (req, context) => {
  const { currentActor, database } = context
  const mastodonAccount = await getMastodonAccount(database, currentActor.data)
  return apiResponse(req, CORS_HEADERS, mastodonAccount)
})
