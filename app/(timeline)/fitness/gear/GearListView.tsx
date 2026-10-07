'use client'

import { Bike, Footprints, Pencil, Plus, RefreshCw, Watch } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useState } from 'react'

import { getFitnessGearList } from '@/lib/client'
import { FitnessAlert } from '@/lib/components/fitness/FitnessAlert'
import { FitnessEmptyState } from '@/lib/components/fitness/FitnessEmptyState'
import {
  FITNESS_TABLE_HEAD_ROW_CLASS,
  FitnessSection
} from '@/lib/components/fitness/FitnessSection'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import {
  type FitnessGearKind,
  type UserCreatableGearKind,
  getSportLabel
} from '@/lib/services/fitness-files/sportTypes'
import type { GearEntity } from '@/lib/services/fitness-gears/gearEntities'
import { cn } from '@/lib/utils'

import { GearFormDialog } from './GearFormDialog'
import { GearProductLink } from './GearProductLink'
import {
  GEAR_TABLE_SCROLLER,
  STICKY_CLICKABLE_COLUMN,
  STICKY_COLUMN,
  STICKY_HEAD_CELL,
  formatGearDistanceKm,
  getGearDisplayName
} from './gearUi'

interface KindCopy {
  sectionTitle: string
  columnHeader: string
  addLabel: string
  emptyTitle: string
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
    emptyTitle: 'No bikes yet.',
    emptyState: 'Add one and new activities will start counting toward it.',
    retiredCountLabel: (count) =>
      `${count} retired bike${count === 1 ? '' : 's'}`,
    hideRetiredLabel: 'Hide retired bikes'
  },
  shoes: {
    sectionTitle: 'Shoes',
    columnHeader: 'Shoes',
    addLabel: 'Add shoes',
    emptyTitle: 'No shoes yet.',
    emptyState: 'Add a pair and new activities will start counting toward it.',
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

/**
 * The row's Actions cell: one Edit button, centred in the column in the
 * symmetric `px-2` the components table gives its own buttons.
 *
 * The column is 10% of the table, so how much room the button has depends on
 * how wide the table is — and "Edit" needs more than a narrow table gives it:
 * the label and its icon measure 62.5px, while the cell leaves 40px of content
 * at the 560px minimum and 74.6px at the 906px maximum. The label therefore
 * shows only where its own cell has the room (a container query on the wrapper,
 * which is as wide as the cell's content) and the pencil stands alone
 * everywhere else. `4rem` is the label's 62.5px rounded up. A viewport
 * breakpoint cannot answer this, because the table's width follows the page's
 * side navigation as much as the viewport: at 800px the table is 694px, and the
 * label overflowed it by 5px.
 */
const GearActionsCell: FC<{
  gear: GearEntity
  onEdit: (gear: GearEntity) => void
}> = ({ gear, onEdit }) => (
  <td className={cn('px-2 py-3 align-middle', gear.retiredAt && 'opacity-60')}>
    <div className="@container flex w-full justify-center">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={(event) => {
          event.stopPropagation()
          onEdit(gear)
        }}
        aria-label={`Edit ${getGearDisplayName(gear)}`}
      >
        <Pencil className="size-3.5" />
        <span className="sr-only @min-[4rem]:not-sr-only">Edit</span>
      </Button>
    </div>
  </td>
)

interface SectionProps {
  kind: UserCreatableGearKind
  gears: GearEntity[]
  onAdd: (kind: UserCreatableGearKind) => void
  onEdit: (gear: GearEntity) => void
}

const GearSection: FC<SectionProps> = ({ kind, gears, onAdd, onEdit }) => {
  const router = useRouter()
  const [showRetired, setShowRetired] = useState(false)

  const copy = KIND_COPY[kind]
  const KindIcon = KIND_ICON[kind]
  const active = gears.filter((gear) => !gear.retiredAt)
  const retired = gears.filter((gear) => gear.retiredAt)
  const visible = showRetired ? [...active, ...retired] : active

  return (
    <FitnessSection
      title={copy.sectionTitle}
      icon={KindIcon}
      meta={`${active.length} active`}
      actions={
        <Button variant="outline" size="sm" onClick={() => onAdd(kind)}>
          <Plus />
          {copy.addLabel}
        </Button>
      }
    >
      {visible.length === 0 ? (
        <FitnessEmptyState icon={KindIcon} title={copy.emptyTitle}>
          {copy.emptyState}
        </FitnessEmptyState>
      ) : (
        <div className={GEAR_TABLE_SCROLLER}>
          <table className="w-full min-w-[560px] table-fixed text-sm">
            {/* 33.5/22.5/14.5/19.5/10, sized from the widest content of each
                column at the design's 590pt card: Distance needs ~112pt for a
                five-digit lifetime total ("35,670.2 km"), a product host needs
                ~125pt, and the first column ~195pt for a default "brand model"
                name. "Default sports" is the one that gives: its header stays on
                one line by overflowing its own padding, and its cells truncate
                ("Ride, Grav…") as the design draws them. That puts Default sports
                at 342pt and Distance's right edge at 518pt from the card's left,
                as the design does. The design's 30% first column was not used: it
                wraps those names and turns a 65pt row into 97. */}
            <colgroup>
              <col className="w-[33.5%]" />
              <col className="w-[22.5%]" />
              <col className="w-[14.5%]" />
              <col className="w-[19.5%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead>
              <tr className={FITNESS_TABLE_HEAD_ROW_CLASS}>
                <th
                  className={cn(
                    STICKY_COLUMN,
                    STICKY_HEAD_CELL,
                    'min-w-[150px] px-4 py-2.5 font-medium'
                  )}
                >
                  {copy.columnHeader}
                </th>
                <th className="px-3 py-2.5 font-medium">Product page</th>
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">
                  Default sports
                </th>
                <th className="px-3 py-2.5 text-right font-medium">Distance</th>
                <th className="px-2 py-2.5 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
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
                    className="group cursor-pointer border-t hover:bg-muted"
                    onClick={() => router.push(getGearHref(gear.id))}
                  >
                    <td
                      className={cn(
                        STICKY_CLICKABLE_COLUMN,
                        'min-w-[150px] px-4 py-3 align-top'
                      )}
                    >
                      {/* Retired gear dims its contents rather than the row:
                          fading the row would take the pinned column's own
                          background down with it and let the data columns
                          scroll through. */}
                      <div className={cn(gear.retiredAt && 'opacity-60')}>
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
                      </div>
                    </td>
                    <td
                      className={cn(
                        'px-3 py-3 align-middle text-xs text-muted-foreground truncate',
                        gear.retiredAt && 'opacity-60'
                      )}
                    >
                      <GearProductLink
                        productUrl={gear.productUrl}
                        onEdit={() => onEdit(gear)}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </td>
                    <td
                      className={cn(
                        'px-3 py-3 align-middle text-xs text-muted-foreground truncate',
                        gear.retiredAt && 'opacity-60'
                      )}
                    >
                      {gear.defaultSports.length > 0
                        ? gear.defaultSports.map(getSportLabel).join(', ')
                        : '—'}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-3 text-right align-middle font-semibold whitespace-nowrap tabular-nums',
                        gear.retiredAt && 'opacity-60'
                      )}
                    >
                      {formatGearDistanceKm(gear.distanceMeters)}
                    </td>
                    <GearActionsCell gear={gear} onEdit={onEdit} />
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {retired.length > 0 && (
        <div>
          <button
            type="button"
            className="cursor-pointer text-xs font-medium text-primary-text hover:underline"
            onClick={() => setShowRetired((current) => !current)}
          >
            {showRetired
              ? copy.hideRetiredLabel
              : `Show ${copy.retiredCountLabel(retired.length)}`}
          </button>
        </div>
      )}
    </FitnessSection>
  )
}

/**
 * Devices get a section of their own rather than another `GearSection`, because
 * almost nothing that section does applies: a device is never added by hand (the
 * import resolves it), it cannot be retired, and it has no default sports and no
 * distance total to put in a column. What is left — a name, where to read about
 * it, and how much it has recorded — is a different table.
 */
const DeviceSection: FC<{
  gears: GearEntity[]
  onEdit: (gear: GearEntity) => void
}> = ({ gears, onEdit }) => {
  const router = useRouter()

  // Nothing to explain and nothing to add: an actor whose activities carry no
  // device information would otherwise get a permanently empty card offering
  // them no way to fill it.
  if (gears.length === 0) return null

  return (
    <FitnessSection
      title="Devices"
      icon={Watch}
      meta={`${gears.length} recording`}
    >
      <div className={GEAR_TABLE_SCROLLER}>
        <table className="w-full min-w-[560px] table-fixed text-sm">
          {/* 33.5/22.5/34/10: the first two columns and the Actions column are
              the bikes and shoes tables' own, so the three tables line up, and
              Activities takes the rest. Its right-aligned count then ends at 90%
              of the table, where Distance ends on the other two. */}
          <colgroup>
            <col className="w-[33.5%]" />
            <col className="w-[22.5%]" />
            <col className="w-[34%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead>
            <tr className={FITNESS_TABLE_HEAD_ROW_CLASS}>
              <th
                className={cn(
                  STICKY_COLUMN,
                  STICKY_HEAD_CELL,
                  'min-w-[150px] px-4 py-2.5 font-medium'
                )}
              >
                Device
              </th>
              <th className="px-3 py-2.5 font-medium">Product page</th>
              <th className="px-3 py-2.5 text-right font-medium">Activities</th>
              <th className="px-2 py-2.5 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {gears.map((gear) => {
              const subline = [gear.brand, gear.model]
                .filter(Boolean)
                .join(' · ')
              return (
                <tr
                  key={gear.id}
                  className="group cursor-pointer border-t hover:bg-muted"
                  onClick={() => router.push(getGearHref(gear.id))}
                >
                  <td
                    className={cn(
                      STICKY_CLICKABLE_COLUMN,
                      'min-w-[150px] px-4 py-3 align-top'
                    )}
                  >
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
                  <td className="px-3 py-3 align-middle text-xs text-muted-foreground truncate">
                    <GearProductLink
                      productUrl={gear.productUrl}
                      onEdit={() => onEdit(gear)}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </td>
                  <td className="px-3 py-3 text-right align-middle font-semibold tabular-nums">
                    {gear.activityCount}
                  </td>
                  <GearActionsCell gear={gear} onEdit={onEdit} />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </FitnessSection>
  )
}

/**
 * The first load's placeholder: the bikes and shoes sections' shape in static
 * `--skeleton` bars (no shimmer), as the overview loads, so the page does not
 * jump from a centred "Loading..." line to two tables.
 */
const GearListSkeleton: FC = () => (
  <div className="space-y-6">
    <p role="status" className="sr-only">
      Loading gear
    </p>
    {[0, 1].map((section) => (
      <div key={section} aria-hidden="true" className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="block h-5 w-16 rounded bg-(--skeleton)" />
          <span className="ml-auto block h-8 w-24 rounded-md bg-(--skeleton)" />
        </div>
        <div className="rounded-lg border">
          <div className="bg-muted/40 h-9 border-b" />
          {[0, 1].map((row) => (
            <div
              key={row}
              className="flex items-center gap-6 border-b px-4 py-4 last:border-b-0"
            >
              <span className="block h-3.5 w-1/3 max-w-40 rounded bg-(--skeleton)" />
              <span className="ml-auto block h-3.5 w-16 rounded bg-(--skeleton)" />
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
)

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
  const [editingGear, setEditingGear] = useState<GearEntity | null>(null)

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
    <div className="space-y-6">
      {error && (
        <FitnessAlert
          title="We couldn’t load your gear"
          action={
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={reload}
              disabled={isRefreshing}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </Button>
          }
        >
          {error}
        </FitnessAlert>
      )}
      {isInitialLoading ? (
        <GearListSkeleton />
      ) : (
        <div
          className={cn(
            'space-y-6 transition-opacity duration-150',
            isRefreshing && 'opacity-60'
          )}
          aria-busy={isRefreshing}
        >
          <GearSection
            kind="bike"
            gears={gears.filter((gear) => gear.kind === 'bike')}
            onAdd={setDialogKind}
            onEdit={setEditingGear}
          />
          <GearSection
            kind="shoes"
            gears={gears.filter((gear) => gear.kind === 'shoes')}
            onAdd={setDialogKind}
            onEdit={setEditingGear}
          />
          <DeviceSection
            gears={gears.filter((gear) => gear.kind === 'device')}
            onEdit={setEditingGear}
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
      {editingGear && (
        <GearFormDialog
          open
          kind={editingGear.kind}
          gear={editingGear}
          onOpenChange={(open) => {
            if (!open) setEditingGear(null)
          }}
          onSaved={reload}
        />
      )}
    </div>
  )
}
