import { apiResponse, defaultOptions } from '@/lib/response'
import { getMastodonActor } from '@/lib/services/actors/getMastodonActor'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/storage/types/oauth'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = OAuthGuard([Scope.enum.read], async (req, context) => {
  const { currentActor, storage } = context
  const mastodonAccount = await getMastodonActor(storage, currentActor.data)
  return apiResponse(req, CORS_HEADERS, mastodonAccount)
})
