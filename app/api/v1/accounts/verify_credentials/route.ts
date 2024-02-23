import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonAccount } from '@/lib/services/mastodon/getMastodonAccount'
import { Scope } from '@/lib/storage/types/oauth'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = OAuthGuard([Scope.enum.read], async (req, context) => {
  const { currentActor, storage } = context
  const mastodonAccount = await getMastodonAccount(storage, currentActor.data)
  return apiResponse(req, CORS_HEADERS, mastodonAccount)
})
