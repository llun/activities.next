'use client'

import {
  Activity,
  Archive,
  ArrowLeft,
  History,
  Pencil,
  Wrench
} from 'lucide-react'
import Link from 'next/link'
import { FC, useEffect, useState } from 'react'

import { GearFormDialog } from '@/app/(timeline)/fitness/gear/GearFormDialog'
import { GearProductLink } from '@/app/(timeline)/fitness/gear/GearProductLink'
import {
  formatGearDate,
  formatGearDistanceKm,
  formatWeightKg,
  getGearDisplayName
} from '@/app/(timeline)/fitness/gear/gearUi'
import {
  getFitnessGearComponents,
  getFitnessGearList,
  setFitnessGearRetired
} from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import {
  SectionNavSelect,
  type SectionNavSelectTab
} from '@/lib/components/section-nav-select'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { Card } from '@/lib/components/ui/card'
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

interface Props {
  gearId: string
  /**
   * The server-side values the activities feed renders posts with. Threaded
   * from the page rather than fetched here: `currentTime` has to be the
   * server's, and `currentActor` must be the narrowed `ActorProfile`.
   */
  feed: GearActivityFeedContext
}

interface StatTileProps {
  label: string
  value: string
}

const StatTile: FC<StatTileProps> = ({ label, value }) => (
  <Card className="flex min-w-0 flex-col gap-2 p-4">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="text-xl font-semibold tabular-nums">{value}</div>
  </Card>
)

const getMetaLine = (gear: GearEntity): string =>
  [
    [gear.brand, gear.model].filter(Boolean).join(' '),
    gear.bikeType,
    gear.weightKilograms === null ? null : formatWeightKg(gear.weightKilograms),
    `added ${formatGearDate(gear.createdAt)}`
  ]
    .filter(Boolean)
    .join(' · ')

export const GearDetailView: FC<Props> = ({ gearId, feed }) => {
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
  // Components first, as the design opens the page: the service log is what a
  // bike's own page is for, and the same activities are one click away here
  // and on the fitness overview.
  const [view, setView] = useState<GearView>('components')
  // Latched on the first switch to Activities and never unset, so the feed
  // survives a switch back to Components with its loaded pages intact.
  const [hasOpenedActivities, setHasOpenedActivities] = useState(false)

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
        setError(found ? null : 'Gear not found.')
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

  const backLink = (
    <Link
      href="/fitness/gear"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Gear
    </Link>
  )

  if (isInitialLoading) {
    return (
      <div className="space-y-4">
        {backLink}
        <p className="py-8 text-center text-sm text-muted-foreground">
          Loading...
        </p>
      </div>
    )
  }

  if (!gear) {
    return (
      <div className="space-y-4">
        {backLink}
        <p className="text-sm text-destructive">{error ?? 'Gear not found.'}</p>
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
        title={
          <span className="flex flex-wrap items-center gap-2">
            {getGearDisplayName(gear)}
            {isRetired && <Badge tone="gray">retired</Badge>}
          </span>
        }
        description={
          <div className="space-y-0.5">
            <div>{getMetaLine(gear)}</div>
            <div>
              {gear.defaultSports.length > 0
                ? `Default for ${gear.defaultSports.map(getSportLabel).join(', ')}`
                : 'No default sports'}
            </div>
            <div>
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
        actions={
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
              disabled={isRetiring}
            >
              {isRetired ? <History /> : <Archive />}
              {isRetired ? 'Unretire' : 'Retire'}
            </Button>
          </div>
        }
      />

      {/* This copy of the error is the one a retire/unretire failure lands in,
          so it announces itself rather than waiting to be noticed. */}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div
        className={
          gear.kind === 'bike'
            ? 'grid grid-cols-1 gap-3 sm:grid-cols-3'
            : 'grid grid-cols-1 gap-3 sm:grid-cols-2'
        }
      >
        <StatTile
          label="Distance"
          value={formatGearDistanceKm(gear.distanceMeters)}
        />
        <StatTile label="Activities" value={String(gear.activityCount)} />
        {gear.kind === 'bike' && (
          <StatTile
            label="Components installed"
            value={String(installedCount)}
          />
        )}
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
    </div>
  )
}
