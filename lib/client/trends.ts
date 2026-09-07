import { Status } from '@/lib/types/domain/status'
import type { PreviewCard } from '@/lib/types/mastodon/previewCard'
import type { Tag } from '@/lib/types/mastodon/tag'

// Trends (https://docs.joinmastodon.org/methods/trends/). All three endpoints
// are read-scope and tolerate logged-out callers. Each helper throws on a
// non-OK response (mirroring getActorStatuses) so the Explore page can tell a
// real failure apart from "nothing is trending" and render its error state; the
// callers that prefer to stay quiet (the Search "Trending now" block) catch and
// hide instead.
const buildTrendsQuery = (limit?: number) =>
  typeof limit === 'number' ? `?limit=${limit}` : ''

const getTrends = async <T>(
  resource: 'tags' | 'statuses' | 'links',
  limit?: number
): Promise<T> => {
  const response = await fetch(
    `/api/v1/trends/${resource}${buildTrendsQuery(limit)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    }
  )
  if (!response.ok) {
    throw new Error(`Failed to load trending ${resource}: ${response.status}`)
  }
  // Every trends endpoint returns a JSON array; coerce anything else to an empty
  // list so callers can safely `.map`/`.length` over the result.
  const data = await response.json()
  return (Array.isArray(data) ? data : []) as T
}

export const getTrendingTags = (limit?: number): Promise<Tag[]> =>
  getTrends<Tag[]>('tags', limit)

// The /explore Posts tab renders trending statuses with the interactive timeline
// post component, which consumes the app's domain Status shape — so this asks the
// endpoint for `format=activities_next` (like the search client) rather than the
// default Mastodon serialization.
export const getTrendingStatuses = async (
  limit?: number
): Promise<Status[]> => {
  const params = new URLSearchParams({ format: 'activities_next' })
  if (typeof limit === 'number') params.set('limit', `${limit}`)
  const response = await fetch(`/api/v1/trends/statuses?${params.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (!response.ok) {
    throw new Error(`Failed to load trending statuses: ${response.status}`)
  }
  const data = await response.json()
  return Array.isArray(data) ? (data as Status[]) : []
}

export const getTrendingLinks = (limit?: number): Promise<PreviewCard[]> =>
  getTrends<PreviewCard[]>('links', limit)
