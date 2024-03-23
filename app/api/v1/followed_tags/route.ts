import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Timeline } from '@/lib/services/timelines/types'
import { Scope } from '@/lib/storage/types/oauth'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  timeline: Timeline
}

export const GET = OAuthGuard<Params>([Scope.enum.read], async (req) => {
  return apiResponse(req, CORS_HEADERS, [])
})
