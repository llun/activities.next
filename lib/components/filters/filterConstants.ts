import { format, formatDistance } from 'date-fns'

import type { FilterContext } from '@/lib/types/domain/filter'

export interface FilterContextOption {
  id: FilterContext
  label: string
  hint: string
}

// Order and copy mirror the Mastodon filter contexts shown in the design.
export const FILTER_CONTEXTS: FilterContextOption[] = [
  {
    id: 'home',
    label: 'Home and lists',
    hint: 'Removed from home feeds and lists'
  },
  {
    id: 'notifications',
    label: 'Notifications',
    hint: 'Matching notifications are not shown'
  },
  {
    id: 'public',
    label: 'Public timelines',
    hint: 'Hidden from local and federated timelines'
  },
  {
    id: 'thread',
    label: 'Conversations',
    hint: 'Hidden in threads and detailed views'
  },
  { id: 'account', label: 'Profiles', hint: 'Hidden when viewing a profile' }
]

// Short labels for the context chips on the list row.
export const CONTEXT_SHORT: Record<FilterContext, string> = {
  home: 'Home',
  notifications: 'Notifications',
  public: 'Public',
  thread: 'Conversations',
  account: 'Profiles'
}

export interface ExpiryOption {
  value: string
  label: string
}

// `value` is the number of seconds for `expires_in`; '0' means never.
export const EXPIRY_OPTIONS: ExpiryOption[] = [
  { value: '0', label: 'Never' },
  { value: '1800', label: '30 minutes' },
  { value: '3600', label: '1 hour' },
  { value: '21600', label: '6 hours' },
  { value: '43200', label: '12 hours' },
  { value: '86400', label: '1 day' },
  { value: '604800', label: '1 week' }
]

// '0' (Never) maps to a null `expires_in`; everything else is seconds.
export const expiresInFromValue = (value: string): number | null =>
  value === '0' ? null : Number(value)

// Pick the select option that best represents an existing filter's remaining
// lifetime. The absolute `expires_at` cannot recover the original `expires_in`,
// so we choose the smallest option that still covers the remaining time. On
// save this re-applies the expiry, matching Mastodon's edit behavior.
export const expiryOptionForExpiresAt = (
  expiresAt: number | null,
  now: number
): string => {
  if (expiresAt === null) return '0'
  const remainingSeconds = Math.round((expiresAt - now) / 1000)
  const match = EXPIRY_OPTIONS.find(
    (option) => option.value !== '0' && Number(option.value) >= remainingSeconds
  )
  return match ? match.value : '604800'
}

export const isFilterExpired = (
  expiresAt: string | null,
  now: number
): boolean => expiresAt !== null && Date.parse(expiresAt) < now

// The meta-line expiry text: "Never expires" / "Expires in 6 days" /
// "Expired Apr 2, 2026".
export const formatExpiry = (expiresAt: string | null, now: number): string => {
  if (expiresAt === null) return 'Never expires'
  const expiresDate = new Date(expiresAt)
  if (Date.parse(expiresAt) < now) {
    return `Expired ${format(expiresDate, 'MMM d, yyyy')}`
  }
  return `Expires ${formatDistance(expiresDate, new Date(now), {
    addSuffix: true
  })}`
}
