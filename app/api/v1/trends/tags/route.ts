import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonTag } from '@/lib/services/mastodon/getMastodonTag'
import { Scope, TagDailyHistoryPoint } from '@/lib/types/database/operations'
import { Tag, TagHistory } from '@/lib/types/mastodon/tag'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const TRENDS_DAYS = 7
const TRENDS_DEFAULT_LIMIT = 10
const TRENDS_MAX_LIMIT = 20
const DAY_MS = 86_400_000

// Garbage or absent input falls back to the default; valid input is clamped
// to the Mastodon maximum of 20. Mirrors normalizeSuggestionsLimit.
const normalizeTrendsLimit = (rawLimit: string | null): number => {
  const limit = rawLimit !== null ? Number(rawLimit) : null
  return Number.isSafeInteger(limit) && limit && limit > 0
    ? Math.min(limit, TRENDS_MAX_LIMIT)
    : TRENDS_DEFAULT_LIMIT
}

const normalizeTrendsOffset = (rawOffset: string | null): number => {
  const offset = rawOffset !== null ? Number(rawOffset) : null
  return Number.isSafeInteger(offset) && offset && offset > 0 ? offset : 0
}

// Seven UTC-day buckets newest first, zero-filled for days without uses.
// `day` is the unix-second start of the UTC day; all values are strings per
// the Mastodon Tag history shape.
const getSevenDayHistory = (
  todayBucketMs: number,
  points: TagDailyHistoryPoint[]
): TagHistory[] => {
  const pointsByDay = new Map(points.map((point) => [point.dayBucketMs, point]))
  return Array.from({ length: TRENDS_DAYS }, (_, index) => {
    const dayBucketMs = todayBucketMs - index * DAY_MS
    const point = pointsByDay.get(dayBucketMs)
    return {
      day: String(dayBucketMs / 1000),
      uses: String(point?.uses ?? 0),
      accounts: String(point?.accounts ?? 0)
    }
  })
}

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

      const todayBucketMs = Math.floor(Date.now() / DAY_MS) * DAY_MS
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
