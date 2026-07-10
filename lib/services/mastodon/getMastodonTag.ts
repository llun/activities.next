import { getConfig } from '@/lib/config'
import { Tag, TagHistory } from '@/lib/types/mastodon/tag'

const getTagUrl = (name: string): string => {
  const host = getConfig().host
  const baseURL = host.includes('://') ? host : `https://${host}`
  return `${baseURL}/tags/${encodeURIComponent(name)}`
}

// Builds a Mastodon Tag entity. https://docs.joinmastodon.org/entities/Tag/
// `history` defaults to empty for callers that do not compute the seven-day
// usage window (see lib/services/trends/tagHistory.ts getTagHistory). `featuring`
// (4.4.0) is optional: callers that do not look the state up simply omit it.
export const getMastodonTag = (
  name: string,
  following: boolean,
  history: TagHistory[] = [],
  featuring?: boolean
): Tag =>
  Tag.parse({
    name: name.replace(/^#+/, ''),
    url: getTagUrl(name.replace(/^#+/, '')),
    history,
    following,
    ...(featuring !== undefined ? { featuring } : null)
  })
