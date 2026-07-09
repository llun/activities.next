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
      const [account, settings] = await Promise.all([
        database.getMastodonActorFromId({ id: currentActor.id }),
        database.getActorSettings({ actorId: currentActor.id })
      ])
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          'posting:default:visibility': account?.source?.privacy ?? 'public',
          'posting:default:sensitive': account?.source?.sensitive ?? false,
          // Mastodon leaves this null when the account never chose a posting
          // language. The Account serializer defaults source.language to 'en',
          // so read the raw setting instead of the serialized account.
          'posting:default:language': settings?.defaultLanguage ?? null,
          'reading:expand:media': currentActor.readingExpandMedia ?? 'default',
          'reading:expand:spoilers':
            currentActor.readingExpandSpoilers ?? false,
          'reading:autoplay:gifs': currentActor.readingAutoplayGifs ?? false
        }
      })
    }
  )
)
