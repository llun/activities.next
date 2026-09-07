import type { FeaturedTag } from '@/lib/types/mastodon/featuredTag'
import type { Tag } from '@/lib/types/mastodon/tag'

// Featured hashtags (https://docs.joinmastodon.org/methods/featured_tags/).
// The hashtags an account pins to its profile. Backed by the featured_tags
// endpoints; every call goes through here so components never call fetch().

// Throws on a non-OK response (rather than returning []) so the editor's load
// handler can tell "you have no featured tags" apart from "the request failed"
// and show its load-error UI. Featured tags are the critical data for the page;
// suggestions below stay best-effort.
export const getFeaturedTags = async (): Promise<FeaturedTag[]> => {
  const response = await fetch('/api/v1/featured_tags', {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (!response.ok) {
    throw new Error(`Failed to load featured tags: ${response.status}`)
  }
  return (await response.json()) as FeaturedTag[]
}

export interface AddFeaturedTagResult {
  tag?: FeaturedTag
  error?: string
}

export const addFeaturedTag = async (
  name: string
): Promise<AddFeaturedTagResult> => {
  try {
    const response = await fetch('/api/v1/featured_tags', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name })
    })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      return { error: data.error || 'Failed to feature hashtag' }
    }
    // Only treat it as a success when the body parses into a real entity —
    // a malformed 2xx body must not surface as a tag with missing fields.
    return { tag: (await response.json()) as FeaturedTag }
  } catch {
    // Network failure / unparseable body — surface as an error result rather
    // than rejecting, so callers can always settle their loading state.
    return { error: 'Failed to feature hashtag' }
  }
}

export const removeFeaturedTag = async (id: string): Promise<boolean> => {
  try {
    const response = await fetch(
      `/api/v1/featured_tags/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: {
          Accept: 'application/json'
        }
      }
    )
    return response.ok
  } catch {
    // Network failure — report as not-removed instead of rejecting.
    return false
  }
}

export const getFeaturedTagSuggestions = async (): Promise<Tag[]> => {
  const response = await fetch('/api/v1/featured_tags/suggestions', {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (!response.ok) return []
  return (await response.json()) as Tag[]
}
