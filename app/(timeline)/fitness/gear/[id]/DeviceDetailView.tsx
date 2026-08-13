'use client'

import { ExternalLink, Pencil } from 'lucide-react'
import Link from 'next/link'
import { FC, useEffect, useRef, useState } from 'react'

import {
  formatGearDate,
  formatGearDistanceKm,
  getGearDisplayName,
  getProductUrlHostname
} from '@/app/(timeline)/fitness/gear/gearUi'
import { type GearActivityItem, getFitnessGearActivities } from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'
import { Card } from '@/lib/components/ui/card'
import type { GearEntity } from '@/lib/services/fitness-gears/gearEntities'

const ACTIVITIES_PAGE_SIZE = 20

interface Props {
  gear: GearEntity
  /** `@user@domain`, for linking an activity row to its status page. */
  actorHandle: string
  backLink: React.ReactNode
  onEdit: () => void
}

const StatTile: FC<{ label: string; value: string }> = ({ label, value }) => (
  <Card className="flex min-w-0 flex-col gap-2 p-4">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="text-xl font-semibold tabular-nums">{value}</div>
  </Card>
)

const getMetaLine = (gear: GearEntity): string =>
  [
    [gear.brand, gear.model].filter(Boolean).join(' '),
    gear.firstUsedAt === null
      ? null
      : `recording since ${formatGearDate(gear.firstUsedAt)}`
  ]
    .filter(Boolean)
    .join(' · ')

/**
 * One activity row: the date it happened, what it was called, its type and its
 * distance. Deliberately a compact list rather than an embedded `Posts` feed —
 * a device's history runs to every activity the owner has ever recorded, and a
 * page of full posts is a scroll through their whole timeline rather than a
 * record of what this device captured.
 */
/**
 * The in-app permalink for an activity's post, or null when it was never
 * posted.
 *
 * `statusPublicId` alone is NOT the test for "was this posted?": the column is
 * nullable and rows written before the public-id backfill keep a null there
 * indefinitely (see docs/maintenance.md → Public ID Backfill). Treating those as
 * unposted would silently unlink an athlete's whole history on an instance that
 * has not run the backfill. `statusId` is the ActivityPub URI, which
 * `resolveStatusFromPath` accepts percent-encoded — the same fallback
 * `getFileStatusLink` uses on the file-management screens.
 */
const getActivityStatusHref = (
  activity: GearActivityItem,
  actorHandle: string
): string | null => {
  if (activity.statusPublicId) {
    return `/${actorHandle}/${activity.statusPublicId}`
  }
  if (activity.statusId) {
    return `/${actorHandle}/${encodeURIComponent(activity.statusId)}`
  }
  return null
}

const ActivityRow: FC<{ activity: GearActivityItem; actorHandle: string }> = ({
  activity,
  actorHandle
}) => {
  const title = activity.description?.trim() || activity.fileName
  const href = getActivityStatusHref(activity, actorHandle)
  const body = (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-sm">
      <span className="w-28 shrink-0 text-muted-foreground tabular-nums">
        {activity.activityStartTime === null
          ? '—'
          : formatGearDate(activity.activityStartTime)}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
      <span className="text-muted-foreground">
        {activity.activityType ?? '—'}
      </span>
      <span className="w-24 shrink-0 text-right tabular-nums">
        {activity.totalDistanceMeters === null
          ? '—'
          : formatGearDistanceKm(activity.totalDistanceMeters)}
      </span>
    </div>
  )

  // An activity that was never posted has no status page to open, so it renders
  // as a plain row rather than a link to nowhere.
  if (!href) {
    return <div className="border-b last:border-b-0">{body}</div>
  }

  return (
    <Link
      // One link per row of a list that grows without bound — prefetching every
      // one of them would fire an RSC request per row as the page scrolls.
      prefetch={false}
      href={href}
      className="block border-b last:border-b-0 hover:bg-muted/50"
    >
      {body}
    </Link>
  )
}

/**
 * A recording device's page. It shares the gear route and the gear dialog, but
 * almost nothing else with a bike: there is no distance total (a head unit
 * records rides and runs alike, so one number would mean nothing), no
 * components, no default sports and no Retire — a device is not something you
 * choose for an activity, it is what captured it.
 */
export const DeviceDetailView: FC<Props> = ({
  gear,
  actorHandle,
  backLink,
  onEdit
}) => {
  const [activities, setActivities] = useState<GearActivityItem[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // How many rows the server has handed over, which is NOT `activities.length`
  // once a duplicate has been dropped. Paging from the list length would then
  // re-request rows already consumed, and a page that is entirely duplicates
  // would leave "Load more" stuck at the same offset forever.
  const consumedRef = useRef(0)
  // The device whose responses are currently welcome. `GearDetailView` renders
  // this component at a fixed position with no `key`, so moving between two
  // device pages swaps `gear` on the SAME instance — without this, a "Load
  // more" fired on the previous device can land after the new device's first
  // page and append its rows here.
  const requestedGearIdRef = useRef(gear.id)

  useEffect(() => {
    let cancelled = false
    requestedGearIdRef.current = gear.id
    consumedRef.current = 0
    setIsLoading(true)
    // Reset before fetching, not after: the previous device's rows would
    // otherwise stay on screen with the previous device's `hasMore`, and a
    // "Load more" clicked in that window would page from the wrong offset and
    // skip the rows in between.
    setActivities([])
    setHasMore(false)

    getFitnessGearActivities(gear.id, { limit: ACTIVITIES_PAGE_SIZE })
      .then((page) => {
        if (cancelled) return
        consumedRef.current = page.activities.length
        setActivities(page.activities)
        setHasMore(page.hasMore)
        setError(null)
      })
      .catch((loadError) => {
        if (cancelled) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load activities.'
        )
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [gear.id])

  const loadMore = async () => {
    const requestedGearId = gear.id
    setIsLoadingMore(true)
    try {
      const page = await getFitnessGearActivities(requestedGearId, {
        limit: ACTIVITIES_PAGE_SIZE,
        offset: consumedRef.current
      })
      // The gear changed while this was in flight, so these rows belong to a
      // page nobody is looking at any more.
      if (requestedGearIdRef.current !== requestedGearId) return

      consumedRef.current += page.activities.length
      // Deduplicated on append: this is offset pagination over a list that can
      // grow, so an activity imported between two pages shifts the window and
      // repeats the boundary row — which React then flags as a duplicate key.
      setActivities((current) => {
        const seen = new Set(current.map((activity) => activity.id))
        return [
          ...current,
          ...page.activities.filter((activity) => !seen.has(activity.id))
        ]
      })
      setHasMore(page.hasMore)
      setError(null)
    } catch (loadError) {
      if (requestedGearIdRef.current !== requestedGearId) return
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load activities.'
      )
    } finally {
      if (requestedGearIdRef.current === requestedGearId) {
        setIsLoadingMore(false)
      }
    }
  }

  const productHostname = getProductUrlHostname(gear.productUrl)
  const metaLine = getMetaLine(gear)

  return (
    <div className="space-y-6">
      {backLink}

      <PageHeader
        title={getGearDisplayName(gear)}
        description={
          <div className="space-y-0.5">
            {metaLine && <div>{metaLine}</div>}
            <div>
              {gear.productUrl && productHostname ? (
                <a
                  href={gear.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  {productHostname}
                  <ExternalLink className="size-3" />
                </a>
              ) : (
                <button
                  type="button"
                  className="cursor-pointer hover:text-foreground hover:underline"
                  onClick={onEdit}
                >
                  No product page — add one
                </button>
              )}
            </div>
          </div>
        }
        actions={
          // Edit only. A device cannot be retired, and deleting one would just
          // be recreated by the next upload from it.
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil />
            Edit
          </Button>
        }
      />

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile label="Activities" value={String(gear.activityCount)} />
        <StatTile
          label="First used"
          value={
            gear.firstUsedAt === null ? '—' : formatGearDate(gear.firstUsedAt)
          }
        />
      </div>

      <Card className="gap-0 py-4">
        <div className="px-4 pb-3">
          <h2 className="text-base font-medium">Activities</h2>
        </div>
        {isLoading ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">Loading...</p>
        ) : activities.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            Nothing recorded on this device yet.
          </p>
        ) : (
          <div className="border-t">
            {activities.map((activity) => (
              <ActivityRow
                key={activity.id}
                activity={activity}
                actorHandle={actorHandle}
              />
            ))}
          </div>
        )}
        {hasMore && !isLoading && (
          <div className="px-4 pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={loadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? 'Loading...' : 'Load more'}
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
