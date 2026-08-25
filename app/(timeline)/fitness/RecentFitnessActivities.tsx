import { X } from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import { Posts } from '@/lib/components/posts/posts'
import { formatActivityTypeLabel } from '@/lib/services/fitness-files/activityPresentation'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'

import { CLEAR_ACTIVITY_FILTER_HREF } from './activityFilter'

interface Props {
  host: string
  currentTime: number
  currentActor: ActorProfile
  statuses: Status[]
  /**
   * The stored `activityType` these statuses were narrowed to, from the page's
   * `?activity=` search param — the same value the Activities table links to.
   * Present means the list is filtered, which is what turns the heading into a
   * clearable chip and the empty list into "nothing of this type" rather than
   * "nothing at all".
   */
  activityType?: string
}

export const RecentFitnessActivities: FC<Props> = ({
  host,
  currentTime,
  currentActor,
  statuses,
  activityType
}) => {
  // An actor with no fitness posts at all still has nothing to say here, but a
  // filter that matched nothing must keep rendering: the chip is the only way
  // back out of it.
  if (statuses.length === 0 && !activityType) return null

  const label = activityType ? formatActivityTypeLabel(activityType) : null

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-medium">Recent activities</h2>
        {label && (
          <Link
            href={CLEAR_ACTIVITY_FILTER_HREF}
            prefetch={false}
            scroll={false}
            aria-label={`Clear ${label} filter`}
            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium text-primary-text transition-colors hover:bg-muted"
          >
            {label}
            <X className="size-3" aria-hidden="true" />
          </Link>
        )}
      </div>
      {statuses.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No recent {label} activities have been posted.
        </p>
      ) : (
        /* `currentActor` without `showActions` deliberately: this stays a
           read-only list (`Posts` gates the action row on both), but `Post` needs
           the viewer to tell that these are the signed-in actor's OWN activities
           and offer the source-file download. Every status here comes from
           `getFitnessFilesByActor({ actorId: currentActor.id })`, so the owner is
           the only person who ever sees this page — without the prop they were
           the one viewer denied a link the endpoint would happily serve them. */
        <Posts
          host={host}
          currentTime={currentTime}
          currentActor={currentActor}
          statuses={statuses}
        />
      )}
    </section>
  )
}
