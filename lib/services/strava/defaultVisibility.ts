import { Visibility } from '@/lib/types/mastodon/visibility'
import { logger } from '@/lib/utils/logger'

/**
 * The visibility an imported Strava activity is posted at, resolved from the
 * actor's stored default.
 *
 * `fitness_settings.defaultVisibility` is TYPED `MastodonVisibility`, but the
 * row mapper reads it straight off a plain varchar column
 * (`row.defaultVisibility || undefined`), so the type is an assertion rather
 * than a guarantee. The write paths validate; the read paths did not agree
 * about it — the webhook route parsed before queueing, while the import job
 * trusted the column raw, which is the arm every retry and repair takes.
 *
 * Falls back to `private` both when nothing is stored and when what is stored
 * is not a visibility: the safe default matters more than the reason, and the
 * two branches are told apart in the log rather than in the return value.
 */
export const resolveStravaDefaultVisibility = ({
  storedVisibility,
  actorId,
  stravaActivityId
}: {
  storedVisibility?: string | null
  actorId?: string
  stravaActivityId?: string
}) => {
  const parsed = Visibility.safeParse(
    storedVisibility ?? Visibility.enum.private
  )
  if (parsed.success) return parsed.data

  logger.warn({
    message: 'Invalid Strava default visibility; falling back to private',
    actorId,
    ...(stravaActivityId ? { stravaActivityId } : {}),
    defaultVisibility: storedVisibility
  })
  return Visibility.enum.private
}
