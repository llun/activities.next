'use client'

import {
  Activity,
  Archive,
  ArrowLeft,
  History,
  MapPin,
  Pencil,
  RefreshCw,
  Trash2,
  Wrench
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, ReactNode, useEffect, useState } from 'react'

import { GearFormDialog } from '@/app/(timeline)/fitness/gear/GearFormDialog'
import { GearProductLink } from '@/app/(timeline)/fitness/gear/GearProductLink'
import {
  formatGearDate,
  formatGearDistanceKm,
  formatWeightKg,
  getGearDisplayName
} from '@/app/(timeline)/fitness/gear/gearUi'
import {
  deleteFitnessGear,
  getFitnessGearComponents,
  getFitnessGearList,
  setFitnessGearRetired
} from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import {
  SectionNavSelect,
  type SectionNavSelectTab
} from '@/lib/components/section-nav-select'
import { Alert } from '@/lib/components/surface/Alert'
import { StatCell } from '@/lib/components/surface/StatCell'
import { StatStrip } from '@/lib/components/surface/StatStrip'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { formatInteger } from '@/lib/fitness/calendar/format'
import { getSportLabel } from '@/lib/services/fitness-files/sportTypes'
import type {
  GearComponentEntity,
  GearEntity
} from '@/lib/services/fitness-gears/gearEntities'
import { cn } from '@/lib/utils'

import { DeviceDetailView } from './DeviceDetailView'
import {
  GearActivitiesFeed,
  type GearActivityFeedContext
} from './GearActivitiesFeed'
import { GearComponentsCard } from './GearComponentsCard'

type GearView = 'components' | 'activities'

/**
 * The two views a bike's page switches between, in the order the design lists
 * them. Shoes and devices carry no components card, so they never render the
 * switcher — a menu with one entry is dead UI — and go straight to the feed.
 */
const GEAR_VIEW_TABS: SectionNavSelectTab<GearView>[] = [
  { id: 'components', label: 'Components', icon: Wrench },
  { id: 'activities', label: 'Activities', icon: Activity }
]

const GearBackLink: FC = () => (
  <Link
    href="/fitness/gear"
    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
  >
    <ArrowLeft className="size-4" />
    Gear
  </Link>
)

/**
 * A gear's page while it loads: the Back link, then the title, meta line and
 * stat strip as shimmering `.skeleton` bars, with one polite status. The route's
 * `loading.tsx` draws the same shape, so the page does not move between the
 * two.
 */
export const GearDetailSkeleton: FC<{ backLink?: ReactNode }> = ({
  backLink = <GearBackLink />
}) => (
  <div aria-busy="true" className="space-y-6">
    {backLink}
    <p role="status" className="sr-only">
      Loading gear
    </p>
    <div aria-hidden="true" className="space-y-6">
      <div className="space-y-2">
        <span className="block h-7 w-48 rounded-md skeleton" />
        <span className="block h-4 w-72 max-w-full rounded skeleton" />
      </div>
      {/* The kind is not known yet, so neither are the labels: bars only, in
          the stat strip's frame. */}
      <div className="h-[70px] rounded-lg border p-4">
        <span className="block h-5 w-24 rounded skeleton" />
        <span className="mt-2 block h-3.5 w-16 rounded skeleton" />
      </div>
    </div>
  </div>
)

interface Props {
  gearId: string
  /**
   * The server-side values the activities feed renders posts with. Threaded
   * from the page rather than fetched here: `currentTime` has to be the
   * server's, and `currentActor` must be the narrowed `ActorProfile`.
   */
  feed: GearActivityFeedContext
}

const GEAR_NOT_FOUND = 'Gear not found.'

const getBrandModel = (gear: GearEntity): string =>
  [gear.brand, gear.model].filter(Boolean).join(' ')

const getMetaLine = (gear: GearEntity): string =>
  [
    // The title already reads "brand model" when the gear has no nickname, so
    // repeating it on the line under it says nothing.
    getBrandModel(gear) === getGearDisplayName(gear)
      ? null
      : getBrandModel(gear),
    gear.bikeType,
    gear.weightKilograms === null ? null : formatWeightKg(gear.weightKilograms),
    `added ${formatGearDate(gear.createdAt)}`
  ]
    .filter(Boolean)
    .join(' · ')

export const GearDetailView: FC<Props> = ({ gearId, feed }) => {
  const router = useRouter()
  const [gear, setGear] = useState<GearEntity | null>(null)
  const [components, setComponents] = useState<GearComponentEntity[]>([])
  // Only the first load blanks the page. A refetch keeps the gear and its
  // components card mounted and merely marks them busy — tearing the card down
  // would close its add form and collapse its "Show N replaced" toggle on
  // every replace.
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isRetiring, setIsRetiring] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // Components first, as the design opens the page: the service log is what a
  // bike's own page is for, and the same activities are one click away here
  // and on the fitness overview.
  const [view, setView] = useState<GearView>('components')
  // Latched on the first switch to Activities and never unset, so the feed
  // survives a switch back to Components with its loaded pages intact.
  const [hasOpenedActivities, setHasOpenedActivities] = useState(false)

  const handleDeleteDialogOpenChange = (open: boolean) => {
    if (isDeleting) return
    setIsDeleteDialogOpen(open)
    if (!open) {
      setDeleteError(null)
    }
  }

  const handleDeleteGear = async () => {
    if (!gear) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await deleteFitnessGear(gear.id)
      router.push('/fitness/gear')
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete gear.'
      )
      setIsDeleting(false)
    }
  }

  const handleViewChange = (nextView: GearView) => {
    setView(nextView)
    if (nextView === 'activities') setHasOpenedActivities(true)
  }

  useEffect(() => {
    let cancelled = false
    setIsRefreshing(true)

    // There is no single-gear endpoint: the list is small, so one round trip
    // and a find is cheaper than adding one.
    getFitnessGearList()
      .then(async (list) => {
        const found = list.find((item) => item.id === gearId) ?? null
        if (cancelled) return
        setGear(found)
        setError(found ? null : GEAR_NOT_FOUND)
        if (!found || found.kind !== 'bike') {
          setComponents([])
          return
        }
        const gearComponents = await getFitnessGearComponents(gearId)
        if (!cancelled) setComponents(gearComponents)
      })
      .catch((loadError) => {
        if (cancelled) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load gear.'
        )
      })
      .finally(() => {
        if (cancelled) return
        setIsInitialLoading(false)
        setIsRefreshing(false)
      })

    return () => {
      cancelled = true
    }
  }, [gearId, reloadToken])

  // Refetch after every mutation: distances, activity counts and the
  // one-gear-per-sport defaults are all derived server-side.
  const reload = () => setReloadToken((token) => token + 1)

  const handleToggleRetired = async () => {
    if (!gear) return
    setIsRetiring(true)
    try {
      await setFitnessGearRetired(gear.id, !gear.retiredAt)
      reload()
    } catch (retireError) {
      setError(
        retireError instanceof Error
          ? retireError.message
          : 'Failed to update gear.'
      )
    } finally {
      setIsRetiring(false)
    }
  }

  const backLink = <GearBackLink />

  if (isInitialLoading) {
    return <GearDetailSkeleton backLink={backLink} />
  }

  if (!gear) {
    return (
      <div className="space-y-6">
        {backLink}
        {error && error !== GEAR_NOT_FOUND ? (
          // A failed read, not a missing row: say so and offer to try again.
          <Alert
            title="We couldn’t load this gear"
            action={
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={reload}
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                Retry
              </Button>
            }
          >
            {error}
          </Alert>
        ) : (
          <Alert title={GEAR_NOT_FOUND}>
            It may have been deleted. Go back to your gear to pick another.
          </Alert>
        )}
      </div>
    )
  }

  // A device shares the fetching, the back link, the error surface and the edit
  // dialog with a bike, and nothing below them: no distance, no components, no
  // retire. Its page is its own component rather than a pile of `kind !==`
  // guards in this one.
  if (gear.kind === 'device') {
    return (
      // A refetch dims the page instead of replacing it, exactly as the bike and
      // shoes branch below does.
      <div
        className={cn(isRefreshing && 'opacity-60')}
        aria-busy={isRefreshing}
      >
        <DeviceDetailView
          gear={gear}
          backLink={backLink}
          onEdit={() => setIsEditOpen(true)}
          feed={feed}
        />
        {isEditOpen && (
          <GearFormDialog
            open
            kind={gear.kind}
            gear={gear}
            onOpenChange={setIsEditOpen}
            onSaved={reload}
          />
        )}
      </div>
    )
  }

  const isRetired = Boolean(gear.retiredAt)
  const installedCount = components.filter(
    (component) => !component.removedAt
  ).length
  // Only a bike has a components card, so only a bike has a Components view;
  // shoes go straight to the feed.
  const showsComponents = gear.kind === 'bike' && view === 'components'
  const shouldMountFeed = !showsComponents || hasOpenedActivities

  return (
    // A refetch dims the page instead of replacing it, the same way the gear
    // list does — the data on screen is still the data the server had.
    <div
      className={cn('space-y-6', isRefreshing && 'opacity-60')}
      aria-busy={isRefreshing}
    >
      {backLink}

      <PageHeader
        // The design sets the stat tiles 15pt under the meta line; the header's
        // own `mb-6` would leave 24.
        className="mb-4"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {getGearDisplayName(gear)}
            {isRetired && <Badge tone="gray">retired</Badge>}
          </span>
        }
        description={
          // ONE 12/16 line, as the design draws it: the facts, what the gear is
          // the default for, and the product page, run together instead of three
          // stacked 14/20 lines. Edit / Retire live under the stat tiles.
          <div className="space-y-0.5 text-xs">
            {/* `align-top` on the link: its inline-flex box otherwise sits on
                the text baseline and stretches the 16pt line to 18.

                The dots are decorative, so they are `aria-hidden` — which
                leaves nothing between the neighbouring spans for a screen
                reader, and "…2025" would run into "Default for…". The `{' '}`
                keeps them apart; it collapses into the dot's own spaces, so
                nothing moves. */}
            <div className="[&_a]:align-top">
              <span>{getMetaLine(gear)}</span>{' '}
              <span aria-hidden="true"> · </span>
              <span>
                {gear.defaultSports.length > 0
                  ? `Default for ${gear.defaultSports.map(getSportLabel).join(', ')}`
                  : 'No default sports'}
              </span>{' '}
              <span aria-hidden="true"> · </span>
              <GearProductLink
                productUrl={gear.productUrl}
                onEdit={() => setIsEditOpen(true)}
              />
            </div>
            {gear.retiredAt && (
              <div>
                {`Retired ${formatGearDate(gear.retiredAt)} — total frozen, excluded from auto-assign and pickers.`}
              </div>
            )}
          </div>
        }
      />

      {/* This copy of the error is the one a retire/unretire failure lands in,
          so it announces itself rather than waiting to be noticed. */}
      {error && <Alert title={error} />}

      <div className="space-y-4">
        {/* The overview's hairline strip, one column per value. */}
        <StatStrip variant="summary" columns={gear.kind === 'bike' ? 3 : 2}>
          <StatCell
            label="Distance"
            icon={MapPin}
            value={formatGearDistanceKm(gear.distanceMeters)}
          />
          <StatCell
            label="Activities"
            icon={Activity}
            value={formatInteger(gear.activityCount)}
          />
          {gear.kind === 'bike' && (
            <StatCell
              label="Components installed"
              icon={Wrench}
              value={formatInteger(installedCount)}
            />
          )}
        </StatStrip>

        {/* The design puts the actions in a left-aligned row under the stat
            tiles, not beside the title. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditOpen(true)}
          >
            <Pencil />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleRetired}
            disabled={isRetiring || isDeleting}
          >
            {isRetired ? <History /> : <Archive />}
            {isRetired ? 'Unretire' : 'Retire'}
          </Button>
          {isRetired && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive-text"
              onClick={() => {
                setDeleteError(null)
                setIsDeleteDialogOpen(true)
              }}
              disabled={isRetiring || isDeleting}
            >
              <Trash2 />
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Only a bike has a second view to reach. */}
      {gear.kind === 'bike' && (
        <SectionNavSelect
          label="Gear sections"
          tabs={GEAR_VIEW_TABS}
          active={view}
          onChange={handleViewChange}
        />
      )}

      {/* Hidden rather than unmounted, for the same reason the refetch above
          keeps it mounted: the card holds its add form, its typed-in values,
          its "Show N retired" toggle and its save error in local state, and a
          glance at Activities mid-form would otherwise throw all of it away. */}
      {gear.kind === 'bike' && (
        <div hidden={!showsComponents}>
          <GearComponentsCard
            gearId={gear.id}
            components={components}
            onChanged={reload}
          />
        </div>
      )}

      {/* Mounted on first use and kept mounted, hidden rather than torn down —
          the same reasoning that keeps the components card alive across a
          refetch. Unmounting would drop every page the reader had scrolled
          through and re-request page one on the way back, and each of those
          pages costs a batched status read the client already had. Lazy,
          though: rendering it eagerly would fetch a feed for every reader who
          never opens the tab. */}
      {shouldMountFeed && (
        <div hidden={showsComponents}>
          <GearActivitiesFeed
            gearId={gear.id}
            emptyMessage="No recent activities on this gear."
            {...feed}
          />
        </div>
      )}

      {isEditOpen && (
        <GearFormDialog
          open
          kind={gear.kind}
          gear={gear}
          onOpenChange={setIsEditOpen}
          onSaved={reload}
        />
      )}

      <Dialog
        open={isDeleteDialogOpen}
        onOpenChange={handleDeleteDialogOpenChange}
      >
        <DialogContent showCloseButton={!isDeleting}>
          <DialogHeader>
            <DialogTitle>Delete {getGearDisplayName(gear)}?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this{' '}
              {gear.kind === 'shoes' ? 'pair of shoes' : 'bike'}?
              {gear.kind === 'bike' && ' All components will be removed.'}{' '}
              Existing activities will remain in your log, but will no longer be
              linked to this gear. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError && <Alert title={deleteError} />}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleDeleteDialogOpenChange(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteGear}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting…' : 'Delete gear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
