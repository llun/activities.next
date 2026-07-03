import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getPreferences',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:accounts']],
    async (req, context) => {
      const { database, currentActor } = context
      const account = await database.getMastodonActorFromId({
        id: currentActor.id
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          'posting:default:visibility': account?.source?.privacy ?? 'public',
          'posting:default:sensitive': account?.source?.sensitive ?? false,
          'posting:default:language': account?.source?.language ?? 'en',
          'reading:expand:media': currentActor.readingExpandMedia ?? 'default',
          'reading:expand:spoilers':
            currentActor.readingExpandSpoilers ?? false,
          'reading:autoplay:gifs': currentActor.readingAutoplayGifs ?? false
        }
      })
    }
  )
)
