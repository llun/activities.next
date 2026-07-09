import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonTag } from '@/lib/services/mastodon/getMastodonTag'
import {
  TRENDS_DAYS,
  normalizeTrendsLimit,
  normalizeTrendsOffset
} from '@/lib/services/trends/request'
import {
  getCurrentDayBucketMs,
  getSevenDayHistory
} from '@/lib/services/trends/tagHistory'
import { Scope } from '@/lib/types/database/operations'
import { Tag } from '@/lib/types/mastodon/tag'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/trends/#tags
// Local trends computed live from public hashtag usage on this instance over
// the last seven days.
export const GET = traceApiRoute(
  'getTrendingTags',
  OptionalOAuthGuard(
    [Scope.enum.read],
    async (req, { database, currentActor }) => {
      const searchParams = new URL(req.url).searchParams
      const limit = normalizeTrendsLimit(searchParams.get('limit'))
      const offset = normalizeTrendsOffset(searchParams.get('offset'))

      const trendingTags = await database.getTrendingTags({
        days: TRENDS_DAYS,
        limit,
        offset
      })
      const history = await database.getTagDailyHistory({
        names: trendingTags.map((trendingTag) => trendingTag.name),
        days: TRENDS_DAYS
      })

      const todayBucketMs = getCurrentDayBucketMs()
      const tags = await Promise.all(
        trendingTags.map(async (trendingTag): Promise<Tag> => {
          const following = currentActor
            ? await database.isFollowingTag({
                actorId: currentActor.id,
                name: trendingTag.name
              })
            : false
          return {
            ...getMastodonTag(trendingTag.name, following),
            history: getSevenDayHistory(
              todayBucketMs,
              history.get(trendingTag.name) ?? []
            )
          }
        })
      )

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: tags })
    }
  )
)
