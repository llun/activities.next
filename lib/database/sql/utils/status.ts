import { PUBLIC_ACTIVITY_RECIPIENTS } from '@/lib/database/kysely/visibility/potentiallyReadable'

// "Addressed to the public collection" (public or unlisted) — Mastodon's
// `distributable?`. Counters a logged-out visitor can read (a status's
// replies_count, a hashtag's post count) only move for these, so a
// followers-only or direct reply or hashtag is not observable as a count.
export const isPubliclyAddressed = ({
  to,
  cc
}: {
  to: string[]
  cc: string[]
}): boolean =>
  [...to, ...cc].some((recipient) =>
    PUBLIC_ACTIVITY_RECIPIENTS.includes(recipient)
  )
