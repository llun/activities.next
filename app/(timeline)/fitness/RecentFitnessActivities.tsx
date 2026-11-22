import { Search, X } from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import { MOBILE_FEED_SURFACE_CLASS } from '@/lib/components/posts/feedLayout'
import { Posts } from '@/lib/components/posts/posts'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { Button } from '@/lib/components/ui/button'
import { formatActivityTypeLabel } from '@/lib/services/fitness-files/activityPresentation'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'

import { FitnessActivitySearch } from './FitnessActivitySearch'
import {
  getClearActivityFilterHref,
  getClearSearchHref
} from './activityFilter'

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
  // The `?q=` words the list was narrowed by, if any.
  query?: string
}

export const RecentFitnessActivities: FC<Props> = ({
  host,
  currentTime,
  currentActor,
  statuses,
  activityType,
  query
}) => {
  const label = activityType ? formatActivityTypeLabel(activityType) : null
  const activeQuery = query?.trim() || undefined

  // Applying or clearing the filter is a navigation that swaps the list below
  // and moves nothing else: `scroll={false}` keeps the page still, the page
  // title is static so Next's route announcer has nothing new to read, and the
  // only other signal is `aria-current` flipping on the link the user is
  // already focused on — which screen readers do not reliably re-announce. This
  // is the one thing that tells them the scope changed.
  //
  // It reports the OUTCOME, not the scope that was asked for. Announcing
  // "Showing recent Run activities" over an empty list is the one wrong thing
  // this region could say, and the visible empty state below cannot correct it:
  // that paragraph is not itself a live region, and with focus unmoved and the
  // page unscrolled nothing carries the reader to it.
  //
  // A live region only announces a change to content it ALREADY held: one that
  // mounts carrying its own text is silent, and so is one React re-creates
  // because it moved in the tree. That is why the section below is always
  // rendered and only its CONTENTS are gated — an actor whose activities have
  // no surviving posts shows nothing here while unfiltered, yet still sees the
  // Activities table (fed by the summary, not by these posts) and can still
  // click a row. Returning early past this region made that first filter — the
  // one transition where nothing else on the page moves either — the one it
  // could not announce. The region is `sr-only`, so it is out of flow and an
  // otherwise-empty section costs no layout.
  const hasNothingToShow =
    statuses.length === 0 && !activityType && !activeQuery
  const clearActivityHref = getClearActivityFilterHref(activeQuery)
  const clearSearchHref = getClearSearchHref(activityType)

  return (
    <section className="space-y-3">
      <p role="status" className="sr-only">
        {statuses.length === 0
          ? activeQuery
            ? label
              ? `No matching ${label} activities.`
              : 'No matching activities.'
            : label
              ? `No recent ${label} activities have been posted.`
              : 'No recent activities have been posted.'
          : label
            ? activeQuery
              ? `Showing matching ${label} activities`
              : `Showing recent ${label} activities`
            : activeQuery
              ? 'Showing matching activities'
              : 'Showing all recent activities'}
      </p>
      {hasNothingToShow ? null : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">Recent activities</h2>
            {label && (
              <Link
                href={clearActivityHref}
                prefetch={false}
                scroll={false}
                aria-label={`Clear ${label} filter`}
                className="inline-flex max-w-full items-center gap-1 rounded-sm border px-2.5 py-0.5 font-mono text-xs font-medium tabular-nums break-words text-primary-text transition-colors hover:bg-muted"
              >
                {label}
                <X className="size-3 shrink-0" aria-hidden="true" />
              </Link>
            )}
          </div>
          <FitnessActivitySearch query={activeQuery} />
          {statuses.length === 0 ? (
            activeQuery ? (
              <EmptyState
                icon={Search}
                title="No matching activities"
                action={
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={clearSearchHref}
                      prefetch={false}
                      scroll={false}
                    >
                      Clear search
                    </Link>
                  </Button>
                }
              >
                No recent{label ? ` ${label}` : ''} activities match “
                {activeQuery}”.
              </EmptyState>
            ) : (
              <p
                className={`rounded-lg border border-dashed p-6 text-center text-sm break-words text-muted-foreground ${MOBILE_FEED_SURFACE_CLASS}`}
              >
                No recent {label} activities have been posted.
              </p>
            )
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
        </>
      )}
    </section>
  )
}
