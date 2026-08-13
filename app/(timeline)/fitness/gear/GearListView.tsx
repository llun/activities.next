'use client'

import { Bike, Footprints, Plus, Watch } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useState } from 'react'

import { getFitnessGearList } from '@/lib/client'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { Card } from '@/lib/components/ui/card'
import {
  type FitnessGearKind,
  type UserCreatableGearKind,
  getSportLabel
} from '@/lib/services/fitness-files/sportTypes'
import type { GearEntity } from '@/lib/services/fitness-gears/gearEntities'
import { cn } from '@/lib/utils'

import { GearFormDialog } from './GearFormDialog'
import {
  formatGearDistanceKm,
  getGearDisplayName,
  getProductUrlHostname
} from './gearUi'

interface KindCopy {
  sectionTitle: string
  columnHeader: string
  addLabel: string
  emptyState: string
  retiredCountLabel: (count: number) => string
  hideRetiredLabel: string
}

// "shoes" is already plural, so its retired toggle counts pairs — "Show 1
// retired pair of shoes" rather than the ungrammatical "1 retired shoes".
//
// The device entries exist to satisfy the exhaustive `Record` — devices render
// through `DeviceSection` below, which shares none of this copy because a device
// is neither added nor retired here.
const KIND_COPY: Record<UserCreatableGearKind, KindCopy> = {
  bike: {
    sectionTitle: 'Bikes',
    columnHeader: 'Bike',
    addLabel: 'Add bike',
    emptyState:
      'No bikes yet. Add one and new activities will start counting toward it.',
    retiredCountLabel: (count) =>
      `${count} retired bike${count === 1 ? '' : 's'}`,
    hideRetiredLabel: 'Hide retired bikes'
  },
  shoes: {
    sectionTitle: 'Shoes',
    columnHeader: 'Shoes',
    addLabel: 'Add shoes',
    emptyState:
      'No shoes yet. Add a pair and new activities will start counting toward it.',
    retiredCountLabel: (count) =>
      `${count} retired pair${count === 1 ? '' : 's'} of shoes`,
    hideRetiredLabel: 'Hide retired shoes'
  }
}

const KIND_ICON: Record<FitnessGearKind, typeof Bike> = {
  bike: Bike,
  shoes: Footprints,
  device: Watch
}

const getGearHref = (gearId: string) =>
  `/fitness/gear/${encodeURIComponent(gearId)}`

interface SectionProps {
  kind: UserCreatableGearKind
  gears: GearEntity[]
  onAdd: (kind: UserCreatableGearKind) => void
}

const GearSection: FC<SectionProps> = ({ kind, gears, onAdd }) => {
  const router = useRouter()
  const [showRetired, setShowRetired] = useState(false)

  const copy = KIND_COPY[kind]
  const KindIcon = KIND_ICON[kind]
  const active = gears.filter((gear) => !gear.retiredAt)
  const retired = gears.filter((gear) => gear.retiredAt)
  const visible = showRetired ? [...active, ...retired] : active

  return (
    <Card className="gap-4 py-4">
      <div className="flex flex-wrap items-center gap-2 px-4">
        <KindIcon className="size-4 text-primary" />
        <h2 className="text-base font-medium">{copy.sectionTitle}</h2>
        <span className="text-sm text-muted-foreground">
          {active.length} active
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => onAdd(kind)}
        >
          <Plus />
          {copy.addLabel}
        </Button>
      </div>

      {visible.length === 0 ? (
        <p className="px-4 text-sm text-muted-foreground">{copy.emptyState}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-2 font-normal">{copy.columnHeader}</th>
                <th className="px-4 py-2 font-normal">Default sports</th>
                <th className="px-4 py-2 text-right font-normal">Distance</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((gear) => {
                const subline = [gear.brand, gear.model]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <tr
                    key={gear.id}
                    className={cn(
                      'cursor-pointer border-b last:border-b-0 hover:bg-muted/50',
                      gear.retiredAt && 'opacity-60'
                    )}
                    onClick={() => router.push(getGearHref(gear.id))}
                  >
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* A real link so the row is reachable by keyboard —
                            the row's own onClick is a pointer affordance only. */}
                        <Link
                          href={getGearHref(gear.id)}
                          className="font-medium hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {getGearDisplayName(gear)}
                        </Link>
                        {gear.retiredAt && <Badge tone="gray">retired</Badge>}
                      </div>
                      {subline && (
                        <div className="text-xs text-muted-foreground">
                          {subline}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {gear.defaultSports.length > 0
                        ? gear.defaultSports.map(getSportLabel).join(', ')
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">
                      {formatGearDistanceKm(gear.distanceMeters)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {retired.length > 0 && (
        <div className="px-4">
          <button
            type="button"
            className="cursor-pointer text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setShowRetired((current) => !current)}
          >
            {showRetired
              ? copy.hideRetiredLabel
              : `Show ${copy.retiredCountLabel(retired.length)}`}
          </button>
        </div>
      )}
    </Card>
  )
}

/**
 * Devices get a section of their own rather than another `GearSection`, because
 * almost nothing that section does applies: a device is never added by hand (the
 * import resolves it), it cannot be retired, and it has no default sports and no
 * distance total to put in a column. What is left — a name, where to read about
 * it, and how much it has recorded — is a different table.
 */
const DeviceSection: FC<{ gears: GearEntity[] }> = ({ gears }) => {
  const router = useRouter()

  // Nothing to explain and nothing to add: an actor whose activities carry no
  // device information would otherwise get a permanently empty card offering
  // them no way to fill it.
  if (gears.length === 0) return null

  return (
    <Card className="gap-4 py-4">
      <div className="flex flex-wrap items-center gap-2 px-4">
        <Watch className="size-4 text-primary" />
        <h2 className="text-base font-medium">Devices</h2>
        <span className="text-sm text-muted-foreground">
          {gears.length} recording
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-4 py-2 font-normal">Device</th>
              <th className="px-4 py-2 font-normal">Product page</th>
              <th className="px-4 py-2 text-right font-normal">Activities</th>
            </tr>
          </thead>
          <tbody>
            {gears.map((gear) => {
              const subline = [gear.brand, gear.model]
                .filter(Boolean)
                .join(' · ')
              const hostname = getProductUrlHostname(gear.productUrl)
              return (
                <tr
                  key={gear.id}
                  className="cursor-pointer border-b last:border-b-0 hover:bg-muted/50"
                  onClick={() => router.push(getGearHref(gear.id))}
                >
                  <td className="px-4 py-2">
                    {/* A real link so the row is reachable by keyboard — the
                        row's own onClick is a pointer affordance only. */}
                    <Link
                      href={getGearHref(gear.id)}
                      className="font-medium hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {getGearDisplayName(gear)}
                    </Link>
                    {subline && (
                      <div className="text-xs text-muted-foreground">
                        {subline}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {hostname && gear.productUrl ? (
                      <a
                        href={gear.productUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {hostname}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">
                    {gear.activityCount}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export const GearListView: FC = () => {
  const [gears, setGears] = useState<GearEntity[]>([])
  // Only the first load blanks the page. A refetch keeps the sections mounted
  // and merely marks them busy — swapping them for "Loading..." would collapse
  // each section's "Show N retired" toggle every time a dialog saves.
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [dialogKind, setDialogKind] = useState<UserCreatableGearKind | null>(
    null
  )

  useEffect(() => {
    let cancelled = false
    setIsRefreshing(true)

    getFitnessGearList()
      .then((list) => {
        if (cancelled) return
        setGears(list)
        setError(null)
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
  }, [reloadToken])

  // Every mutation refetches instead of patching local state: distances are
  // derived server-side and the one-gear-per-sport rule can move a default
  // sport off a row this mutation never touched.
  const reload = () => setReloadToken((token) => token + 1)

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {isInitialLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Loading...
        </p>
      ) : (
        <div
          className={cn('space-y-4', isRefreshing && 'opacity-60')}
          aria-busy={isRefreshing}
        >
          <GearSection
            kind="bike"
            gears={gears.filter((gear) => gear.kind === 'bike')}
            onAdd={setDialogKind}
          />
          <GearSection
            kind="shoes"
            gears={gears.filter((gear) => gear.kind === 'shoes')}
            onAdd={setDialogKind}
          />
          <DeviceSection
            gears={gears.filter((gear) => gear.kind === 'device')}
          />
        </div>
      )}

      {dialogKind && (
        <GearFormDialog
          open
          kind={dialogKind}
          onOpenChange={(open) => {
            if (!open) setDialogKind(null)
          }}
          onSaved={reload}
        />
      )}
    </div>
  )
}
