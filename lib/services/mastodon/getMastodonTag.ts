import { getConfig } from '@/lib/config'
import { Tag } from '@/lib/types/mastodon/tag'

const getTagUrl = (name: string): string => {
  const host = getConfig().host
  const baseURL = host.includes('://') ? host : `https://${host}`
  return `${baseURL}/tags/${encodeURIComponent(name)}`
}

// Builds a Mastodon Tag entity. https://docs.joinmastodon.org/entities/Tag/
// Trend history is not indexed yet, so `history` is always empty.
export const getMastodonTag = (name: string, following: boolean): Tag =>
  Tag.parse({
    name: name.replace(/^#+/, ''),
    url: getTagUrl(name.replace(/^#+/, '')),
    history: [],
    following
  })
