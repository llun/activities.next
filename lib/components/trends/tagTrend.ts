import type { Tag } from '@/lib/types/mastodon/tag'

// The Mastodon Tag `history` array is ordered newest-first, one bucket per day,
// with `uses`/`accounts` encoded as strings. The trend surfaces want the daily
// uses oldest→newest (so the sparkline reads left-to-right in time) and the
// number of distinct people over the most recent two days. `history` is treated
// defensively as optional — remote/federated tags can arrive without it.

const toCount = (value: string | undefined): number => {
  if (value === undefined) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

// Daily `uses` ordered oldest→newest for plotting.
export const getTagUsesHistory = (tag: Tag): number[] =>
  [...(tag.history ?? [])].reverse().map((point) => toCount(point.uses))

// Distinct accounts that used the tag across the two most recent days.
export const getTagPeoplePast2Days = (tag: Tag): number =>
  (tag.history ?? [])
    .slice(0, 2)
    .reduce((total, point) => total + toCount(point.accounts), 0)
