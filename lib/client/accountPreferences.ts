import type { QuoteApprovalPolicy } from '@/lib/types/domain/status'

export interface PreferencesInput {
  // Posting defaults — saved through the standard Mastodon credential endpoint.
  visibility: 'public' | 'unlisted' | 'private' | 'direct'
  // Default quote-approval policy for new public/unlisted posts (Mastodon 4.5).
  quotePolicy: QuoteApprovalPolicy
  sensitive: boolean
  language: string
  // Reading preferences — saved through the web-internal endpoint.
  expandMedia: 'default' | 'show_all' | 'hide_all'
  expandSpoilers: boolean
  autoplayGifs: boolean
}

// Persists posting defaults and reading preferences. Posting defaults go to
// PATCH /api/v1/accounts/update_credentials (the documented Mastodon write path
// third-party clients also use); reading preferences go to the web-internal
// endpoint since GET /api/v1/preferences is read-only by design.
//
// The two writes run sequentially and the reading POST is skipped if the
// posting PATCH fails. This narrows — but does not eliminate — the partial-
// update window: if the PATCH succeeds and the POST then fails, the posting
// defaults are already persisted while the reading prefs are not. Both writes
// are idempotent, so retrying after any failure re-applies the identical
// payloads and converges to a consistent state.
export const updatePreferences = async (
  preferences: PreferencesInput
): Promise<boolean> => {
  const postingResponse = await fetch('/api/v1/accounts/update_credentials', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: {
        privacy: preferences.visibility,
        quote_policy: preferences.quotePolicy,
        sensitive: preferences.sensitive,
        language: preferences.language
      }
    })
  })
  if (!postingResponse.ok) return false

  const readingResponse = await fetch('/api/v1/accounts/reading-preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      readingExpandMedia: preferences.expandMedia,
      readingExpandSpoilers: preferences.expandSpoilers,
      readingAutoplayGifs: preferences.autoplayGifs
    })
  })
  return readingResponse.ok
}

// --- Navigation customization ---

export interface NavigationPreferencesInput {
  // The user's sidebar order and the items tucked under "More". Both are full
  // snapshots: the caller sends the entire list on every save so concurrent
  // edits resolve to last-write-wins rather than interleaving deltas. Empty
  // arrays reset to the shipped defaults.
  navOrder: string[]
  navHidden: string[]
}

export const updateNavigationPreferences = async (
  preferences: NavigationPreferencesInput
): Promise<boolean> => {
  const response = await fetch('/api/v1/accounts/navigation-preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences)
  })
  return response.ok
}
