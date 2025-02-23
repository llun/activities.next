import { Scope } from '@/lib/database/types/oauth'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const DEFAULT_USER_PREFERENCES = {
  'posting:default:visibility': 'public',
  'posting:default:sensitive': false,
  'posting:default:language': 'en',
  'reading:expand:media': 'default',
  'reading:expand:spoilers': false,
  'reading:autoplay:gifs': false
}

export const GET = OAuthGuard([Scope.enum.read], async (req) => {
  return apiResponse(req, CORS_HEADERS, DEFAULT_USER_PREFERENCES)
})
