'use client'

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Wrench
} from 'lucide-react'
import { FC, useId, useState } from 'react'

import { GearProductLink } from '@/app/(timeline)/fitness/gear/GearProductLink'
import {
  GEAR_TABLE_SCROLLER,
  STICKY_COLUMN,
  STICKY_HEAD_CELL,
  STICKY_LEFT_SHADOW,
  STICKY_RIGHT_COLUMN,
  STICKY_RIGHT_SHADOW,
  formatGearDate,
  formatGearDistanceKm,
  getWearState
} from '@/app/(timeline)/fitness/gear/gearUi'
import { useGearTableColumns } from '@/app/(timeline)/fitness/gear/useGearTableColumns'
import {
  deleteFitnessGearComponent,
  refitFitnessGearComponent,
  retireFitnessGearComponent
} from '@/lib/client'
import { FitnessAlert } from '@/lib/components/fitness/FitnessAlert'
import { FitnessEmptyState } from '@/lib/components/fitness/FitnessEmptyState'
import { FITNESS_TABLE_HEAD_ROW_CLASS } from '@/lib/components/fitness/FitnessSection'
import { Button } from '@/lib/components/ui/button'
import type { GearComponentEntity } from '@/lib/services/fitness-gears/gearEntities'
import { cn } from '@/lib/utils'

import { GearComponentFormDialog } from './GearComponentFormDialog'

interface Props {
  gearId: string
  components: GearComponentEntity[]
  /** Refetch the gear and its components — distances are derived server-side. */
  onChanged: () => void
}

/**
 * Width of the pinned "Type" column. `STICKY_COLUMN` deliberately leaves this
 * to the caller (the design pins the gear tables at 150px and this denser
 * seven-column table at 104px), and here it is load-bearing twice: it sizes the
 * column and it is the `scroll-padding-left` the snapped columns land against.
 *
 * It is wider than the design's 104px because our pinned cell spends more of
 * that width on padding: the design runs a flat `px-3` across all seven columns,
 * while this table uses `px-4` on the pinned one so the column lines up with the
 * card header above it. At 104px that left 72px of content, and "Handlebar"
 * measures 72.6px at `text-sm font-medium` — so the single most ordinary value
 * in `COMPONENT_TYPE_OPTIONS` broke mid-word, as "Handleba / r". `wrap-anywhere`
 * is what makes that break look like a defect rather than a wrap, and it has to
 * stay (see `CELL_WRAP`), so the column is sized to fit instead.
 *
 * 120px leaves 88px of content, clear of the widest single word in the option
 * list — "Chainrings" at 74.7px — with enough headroom for the wider system
 * fonts other platforms substitute into the same stack. Multi-word values still
 * wrap, but at their spaces: "Front brake pads" needs 117px on one line, which
 * would be 149px of pinned column, 38% of a 390px phone for a column of short
 * labels. The design does not spend that either.
 */
const TYPE_COLUMN_WIDTH = 120

/**
 * Width of the "Brand" column off-snap. Sized to fit brand names with
 * generous headroom for system font variations across platforms.
 */
const BRAND_COLUMN_WIDTH = 140

/** Width of the "Model" column off-snap. */
const MODEL_COLUMN_WIDTH = 160

/** Width of the "Product page" column off-snap. */
const PRODUCT_PAGE_COLUMN_WIDTH = 130

/** Width of the "Distance" column off-snap. */
const DISTANCE_COLUMN_WIDTH = 140

/** Width of the "Added" column off-snap. */
const ADDED_COLUMN_WIDTH = 130

/** Width of the "Retired" column off-snap. */
const RETIRED_COLUMN_WIDTH = 110

/**
 * Width of the actions column, pinned or off-snap. Sized to fit a row's two
 * action buttons ("Edit" and "Retire", or "Refit" and "Delete") side-by-side
 * horizontally without wrapping — armed ones included, which is why an armed
 * button reads "Confirm" and keeps what it confirms in its accessible name:
 * "Refit" beside "Confirm delete" measured 152px against the 124px between
 * this column's padding, and a pinned cell's content that overflows spills
 * across the divider and off the card's edge.
 */
const ACTIONS_COLUMN_WIDTH = 140

/**
 * Data columns between the pinned Type and Actions columns. On a phone the
 * actions column unpins and snaps as one more (`isRightPinned`).
 */
const TOTAL_MIDDLE_COLUMNS = 6

/** Target minimum column width used to compute integer visible columns. */
const TARGET_COLUMN_WIDTH = 150

/**
 * A long unbroken component type, brand or model would otherwise widen its
 * column past the width below — a `<td>`'s width is advisory — and under
 * `scroll-snap-type: x mandatory` a column wider than its snap interval has a
 * tail the scroller can never come to rest on. All three are free text to 255
 * characters (`gearRequests.ts`), so none of them can be trusted to be short.
 */
const CELL_WRAP = 'wrap-anywhere'

/** Fades a pinned column's edge shadow in and out as the scroll cues change. */
const EDGE_SHADOW_TRANSITION =
  'transition-shadow duration-200 motion-reduce:transition-none'

const SCROLL_STEP_BUTTON =
  'size-7 text-muted-foreground hover:text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50'

/**
 * Fades a retired row in when "Show retired" reveals it (or a row is retired
 * while they are shown). It goes on the CELLS — and on the pinned cells'
 * content, never the pinned cells — for the same reason a retired row dims its
 * cells: `opacity` on the `<tr>` or a pinned `<td>` fades that cell's opaque
 * surface too, and the data columns would scroll through it mid-fade.
 */
const RETIRED_ROW_ENTER =
  'animate-in fade-in-0 duration-300 motion-reduce:animate-none'

/**
 * One line per install period, so a part that came off and went back on shows
 * the gap rather than collapsing to a single window. The Added and Retired
 * columns are read as a pair: line N of one and line N of the other are the two
 * ends of the same period.
 *
 * A component with one period — every row that existed before install history,
 * and every part that has never been refitted — renders exactly the single line
 * it always did.
 */
const PeriodDates: FC<{
  component: GearComponentEntity
  bound: 'addedAt' | 'removedAt'
}> = ({ component, bound }) => {
  const emptyLabel = bound === 'addedAt' ? 'Since beginning' : '—'
  // A component with no periods is not a shape the API produces; falling back
  // to the derived pair keeps the cell from rendering empty if one ever is.
  const periods = component.periods.length
    ? component.periods
    : [{ addedAt: component.addedAt, removedAt: component.removedAt }]

  return (
    <>
      {periods.map((period, index) => (
        <div key={index}>
          {/* Which line belongs to which period is carried by POSITION, and
              position is exactly what a screen reader drops: it reads out every
              Added date, then every Retired date, with nothing saying that the
              second of one goes with the second of the other. Numbering the
              lines restores the pairing, and only where there is a pairing to
              restore — a component with one period, which is every part that
              has never been refitted, announces exactly the bare date it
              always did. */}
          {periods.length > 1 && (
            <span className="sr-only">{`Install ${index + 1}: `}</span>
          )}
          {period[bound] === null || period[bound] === undefined
            ? emptyLabel
            : formatGearDate(period[bound] as number)}
        </div>
      ))}
    </>
  )
}

const WearBar: FC<{ component: GearComponentEntity }> = ({ component }) => {
  const wear = getWearState(
    component.distanceMeters,
    component.serviceDistanceMeters
  )
  if (!wear) return null

  return (
    <>
      {/* `aria-valuenow` has to stay inside the min/max, so an overdue
          component reports 100 there and its real wear in `aria-valuetext`. */}
      <div
        role="progressbar"
        aria-label={`${component.componentType} wear`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(wear.barPercent)}
        aria-valuetext={`${Math.round(wear.percent)}% of service interval`}
        className="mt-1 ml-auto h-1 w-20 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn('h-full', wear.barClassName)}
          style={{ width: wear.barWidth }}
        />
      </div>
      <div className={cn('mt-0.5 text-xs', wear.captionClassName)}>
        {wear.caption}
      </div>
    </>
  )
}

export const GearComponentsCard: FC<Props> = ({
  gearId,
  components,
  onChanged
}) => {
  const headingId = useId()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingComponent, setEditingComponent] =
    useState<GearComponentEntity | null>(null)
  const [showRetired, setShowRetired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  // A second click on the same row's Retire or Delete confirms it — cheaper
  // than a dialog, and still not a single misclick. Retire arms too: it is not
  // destructive the way Delete is, since the Refit beside it puts the row back,
  // but it closes the open install period, so a stray click silently stops the
  // part accruing distance and it takes reading the table closely to notice.
  //
  // ONE id, not one per action: a row offers exactly one confirmable action and
  // `component.removedAt` decides which, so a single id makes "armed for the
  // action this row no longer offers" unrepresentable. With two, refitting a
  // row armed for Delete left that arm set, and retiring it again brought the
  // Delete button back already armed — a one-click delete, which is the hazard
  // the disarm rules exist to prevent.
  const [confirmingActionId, setConfirmingActionId] = useState<string | null>(
    null
  )
  const {
    ref: scrollerRef,
    isSnapping,
    canScrollLeft,
    canScrollRight,
    scrollByColumn,
    isRightPinned,
    pinnedColumnStyle,
    pinnedRightStyle,
    dataColumnStyle,
    scrollerStyle
  } = useGearTableColumns(TYPE_COLUMN_WIDTH, {
    pinnedRightWidth: ACTIONS_COLUMN_WIDTH,
    totalColumns: TOTAL_MIDDLE_COLUMNS,
    targetColumnWidth: TARGET_COLUMN_WIDTH
  })

  const installed = components.filter((component) => !component.removedAt)
  const retired = components.filter((component) => component.removedAt)
  const visible = showRetired ? [...installed, ...retired] : installed

  const handleRetire = async (componentId: string) => {
    if (confirmingActionId !== componentId) {
      setConfirmingActionId(componentId)
      return
    }

    setError(null)
    setPendingActionId(componentId)
    try {
      await retireFitnessGearComponent(gearId, componentId)
      setConfirmingActionId(null)
      onChanged()
    } catch (retireError) {
      setError(
        retireError instanceof Error
          ? retireError.message
          : 'Failed to retire component.'
      )
    } finally {
      setPendingActionId(null)
    }
  }

  // Refit, not Unretire: it opens a NEW install period starting today and
  // leaves the closed one alone. This used to clear `removedAt`, which reopened
  // the ORIGINAL window — undoing a retire from last season then credited the
  // part every activity ridden while it sat off the bike, and re-retiring could
  // not take that back, because it only closed the window at the new today.
  // A new period costs the gap instead: seconds for a misclick, and the truth
  // for a part that really did spend a season on the shelf.
  //
  // Still unarmed, for the reason it always was: arming it would add friction
  // to the misclick this exists to recover from. What has changed is that a
  // stray click is now cheap in BOTH directions.
  const handleRefit = async (componentId: string) => {
    setError(null)
    // The row is about to offer Retire instead of Delete; carrying an arm
    // across that flip is what the single id exists to prevent.
    setConfirmingActionId(null)
    setPendingActionId(componentId)
    try {
      await refitFitnessGearComponent(gearId, componentId)
      onChanged()
    } catch (refitError) {
      setError(
        refitError instanceof Error
          ? refitError.message
          : 'Failed to refit component.'
      )
    } finally {
      setPendingActionId(null)
    }
  }

  const handleDelete = async (componentId: string) => {
    if (confirmingActionId !== componentId) {
      setConfirmingActionId(componentId)
      return
    }

    setError(null)
    setPendingActionId(componentId)
    try {
      await deleteFitnessGearComponent(gearId, componentId)
      setConfirmingActionId(null)
      onChanged()
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Failed to delete component.'
      )
    } finally {
      setPendingActionId(null)
    }
  }

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      {/* The overview's section heading row (see `FitnessSection`), built by
          hand because the scroll steppers sit between the count and Add. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id={headingId} className="text-base font-semibold">
          Components
        </h2>
        <span className="text-sm text-muted-foreground">
          {installed.length} installed
        </span>
        {/* `aria-disabled`, not `disabled`, at either end — as on the post
            media strip: a disabled button drops keyboard focus to the page the
            moment the last step reaches the edge. */}
        {isSnapping && (
          <div className="ml-1 flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className={SCROLL_STEP_BUTTON}
              aria-disabled={!canScrollLeft}
              onClick={() => {
                if (!canScrollLeft) return
                scrollByColumn('left')
              }}
              aria-label="Scroll components table left"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={SCROLL_STEP_BUTTON}
              aria-disabled={!canScrollRight}
              onClick={() => {
                if (!canScrollRight) return
                scrollByColumn('right')
              }}
              aria-label="Scroll components table right"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => {
            setConfirmingActionId(null)
            setIsAddOpen(true)
          }}
        >
          <Plus />
          Add component
        </Button>
      </div>

      {error && <FitnessAlert title={error} />}

      <GearComponentFormDialog
        open={isAddOpen || Boolean(editingComponent)}
        gearId={gearId}
        component={editingComponent}
        onOpenChange={(open) => {
          if (!open) {
            setIsAddOpen(false)
            setEditingComponent(null)
          }
        }}
        onSaved={onChanged}
      />

      {visible.length === 0 ? (
        <FitnessEmptyState icon={Wrench} title="No components yet.">
          Add the parts you want to track and each one accrues distance from its
          added date.
        </FitnessEmptyState>
      ) : (
        // Below the full-width threshold (1160px: 120px Type + 140px Actions +
        // 6x150px middle) this snaps whole columns per swipe with dual-pinned
        // bookends ("Type" left, "Actions" right), fitting an exact integer
        // number of middle columns edge-to-edge so no half column is cut off.
        // Below 480px (a phone) "Actions" unpins and snaps as the last column,
        // one column per swipe beside "Type". Above the threshold all columns
        // fit side-by-side. The old `min-w-[720px]` is gone because per-cell
        // minimums already size columns cleanly.
        <div
          ref={scrollerRef}
          className={GEAR_TABLE_SCROLLER}
          style={scrollerStyle}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className={FITNESS_TABLE_HEAD_ROW_CLASS}>
                <th
                  className={cn(
                    STICKY_COLUMN,
                    STICKY_HEAD_CELL,
                    'px-4 py-2.5 font-medium',
                    EDGE_SHADOW_TRANSITION,
                    canScrollLeft && STICKY_LEFT_SHADOW
                  )}
                  style={pinnedColumnStyle}
                >
                  Type
                </th>
                <th
                  className="px-3 py-2.5 font-medium"
                  style={dataColumnStyle(BRAND_COLUMN_WIDTH)}
                >
                  Brand
                </th>
                <th
                  className="px-3 py-2.5 font-medium"
                  style={dataColumnStyle(MODEL_COLUMN_WIDTH)}
                >
                  Model
                </th>
                <th
                  className="px-3 py-2.5 font-medium"
                  style={dataColumnStyle(PRODUCT_PAGE_COLUMN_WIDTH)}
                >
                  Product page
                </th>
                <th
                  className="px-3 py-2.5 text-right font-medium"
                  style={dataColumnStyle(DISTANCE_COLUMN_WIDTH)}
                >
                  Distance
                </th>
                <th
                  className="px-3 py-2.5 font-medium"
                  style={dataColumnStyle(ADDED_COLUMN_WIDTH)}
                >
                  Added
                </th>
                <th
                  className="px-3 py-2.5 font-medium"
                  style={dataColumnStyle(RETIRED_COLUMN_WIDTH)}
                >
                  Retired
                </th>
                <th
                  className={
                    isRightPinned
                      ? cn(
                          STICKY_RIGHT_COLUMN,
                          STICKY_HEAD_CELL,
                          'px-2 py-2.5 font-medium',
                          EDGE_SHADOW_TRANSITION,
                          canScrollRight && STICKY_RIGHT_SHADOW
                        )
                      : 'px-3 pr-4 py-2.5 font-medium'
                  }
                  style={
                    isRightPinned
                      ? pinnedRightStyle
                      : dataColumnStyle(ACTIONS_COLUMN_WIDTH)
                  }
                >
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((component) => {
                const isRetired = Boolean(component.removedAt)
                const isPending = pendingActionId === component.id
                return (
                  <tr key={component.id} className="border-t">
                    {/* A retired component dims its contents rather than the
                        row: fading the row would take the pinned column's own
                        background down with it and let the data columns scroll
                        through. */}
                    <td
                      className={cn(
                        STICKY_COLUMN,
                        CELL_WRAP,
                        'px-4 py-2.5 align-top font-medium',
                        EDGE_SHADOW_TRANSITION,
                        canScrollLeft && STICKY_LEFT_SHADOW
                      )}
                      style={pinnedColumnStyle}
                    >
                      <div
                        className={cn(
                          isRetired && ['opacity-60', RETIRED_ROW_ENTER]
                        )}
                      >
                        {component.componentType}
                      </div>
                    </td>
                    <td
                      className={cn(
                        CELL_WRAP,
                        'px-3 py-2.5 align-top text-muted-foreground',
                        isRetired && ['opacity-60', RETIRED_ROW_ENTER]
                      )}
                      style={dataColumnStyle(BRAND_COLUMN_WIDTH)}
                    >
                      {component.brand || '—'}
                    </td>
                    <td
                      className={cn(
                        CELL_WRAP,
                        'px-3 py-2.5 align-top text-muted-foreground',
                        isRetired && ['opacity-60', RETIRED_ROW_ENTER]
                      )}
                      style={dataColumnStyle(MODEL_COLUMN_WIDTH)}
                    >
                      {component.model || '—'}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2.5 align-top text-xs text-muted-foreground truncate',
                        isRetired && ['opacity-60', RETIRED_ROW_ENTER]
                      )}
                      style={dataColumnStyle(PRODUCT_PAGE_COLUMN_WIDTH)}
                    >
                      <GearProductLink productUrl={component.productUrl} />
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2.5 text-right align-top whitespace-nowrap',
                        isRetired && ['opacity-60', RETIRED_ROW_ENTER]
                      )}
                      style={dataColumnStyle(DISTANCE_COLUMN_WIDTH)}
                    >
                      <span className="font-semibold tabular-nums">
                        {formatGearDistanceKm(component.distanceMeters)}
                      </span>
                      <WearBar component={component} />
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2.5 align-top whitespace-nowrap text-muted-foreground',
                        isRetired && ['opacity-60', RETIRED_ROW_ENTER]
                      )}
                      style={dataColumnStyle(ADDED_COLUMN_WIDTH)}
                    >
                      <PeriodDates component={component} bound="addedAt" />
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2.5 align-top whitespace-nowrap text-muted-foreground',
                        isRetired && ['opacity-60', RETIRED_ROW_ENTER]
                      )}
                      style={dataColumnStyle(RETIRED_COLUMN_WIDTH)}
                    >
                      <PeriodDates component={component} bound="removedAt" />
                    </td>
                    {/* Pinned, the buttons sit centred between symmetric
                        padding; unpinned on a phone, the column is a snapped
                        data column again and they keep to its right edge, as
                        they did before the column was pinned. */}
                    <td
                      className={
                        isRightPinned
                          ? cn(
                              STICKY_RIGHT_COLUMN,
                              'px-2 py-2.5 align-top whitespace-nowrap',
                              EDGE_SHADOW_TRANSITION,
                              canScrollRight && STICKY_RIGHT_SHADOW
                            )
                          : 'px-3 py-2.5 pr-4 text-right align-top whitespace-nowrap'
                      }
                      style={
                        isRightPinned
                          ? pinnedRightStyle
                          : dataColumnStyle(ACTIONS_COLUMN_WIDTH)
                      }
                    >
                      <div
                        className={cn(
                          'flex flex-nowrap items-center gap-1',
                          isRightPinned
                            ? 'w-full justify-center'
                            : 'justify-end',
                          isRetired && RETIRED_ROW_ENTER
                        )}
                      >
                        {isRetired ? (
                          <>
                            <Button
                              size="sm"
                              type="button"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-primary-text"
                              aria-label={`Refit ${component.componentType}`}
                              disabled={isPending}
                              onClick={() => handleRefit(component.id)}
                            >
                              Refit
                            </Button>
                            <Button
                              size="sm"
                              type="button"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-destructive"
                              aria-label={
                                confirmingActionId === component.id
                                  ? `Confirm delete ${component.componentType}`
                                  : `Delete ${component.componentType}`
                              }
                              disabled={isPending}
                              onClick={() => handleDelete(component.id)}
                              // Leaving the button disarms it: an armed row that
                              // stays armed is a destructive single click waiting
                              // for whoever comes back to this table.
                              onBlur={() => {
                                if (confirmingActionId === component.id) {
                                  setConfirmingActionId(null)
                                }
                              }}
                            >
                              {confirmingActionId === component.id
                                ? 'Confirm'
                                : 'Delete'}
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              type="button"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                              aria-label={`Edit ${component.componentType}`}
                              disabled={isPending}
                              onClick={() => {
                                setConfirmingActionId(null)
                                setEditingComponent(component)
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              type="button"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-primary-text"
                              aria-label={
                                confirmingActionId === component.id
                                  ? `Confirm retire ${component.componentType}`
                                  : `Retire ${component.componentType}`
                              }
                              disabled={isPending}
                              onClick={() => handleRetire(component.id)}
                              // Same disarm rule as Delete: an armed row left
                              // armed closes the next visitor's install window on
                              // one click.
                              onBlur={() => {
                                if (confirmingActionId === component.id) {
                                  setConfirmingActionId(null)
                                }
                              }}
                            >
                              {confirmingActionId === component.id
                                ? 'Confirm'
                                : 'Retire'}
                            </Button>
                          </>
                        )}
                      </div>
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
            className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-primary-text hover:underline"
            // Hiding the retired rows must disarm any pending confirmation
            // with them: the armed row would otherwise come back armed and
            // delete on the first click after the next "Show ...".
            onClick={() => {
              setShowRetired((current) => !current)
              setConfirmingActionId(null)
            }}
          >
            <ChevronDown
              className={cn(
                'size-3.5 transition-transform duration-300 motion-reduce:transition-none',
                showRetired && 'rotate-180'
              )}
            />
            {showRetired
              ? 'Hide retired components'
              : `Show ${retired.length} retired component${
                  retired.length === 1 ? '' : 's'
                }`}
          </button>
        </div>
      )}
    </section>
  )
}
