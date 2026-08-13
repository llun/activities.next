'use client'

import { Plus, Wrench } from 'lucide-react'
import { FC, FormEvent, useState } from 'react'

import {
  COMPONENT_TYPE_OPTIONS,
  formatGearDate,
  formatGearDistanceKm,
  formatKmInt,
  getWearState
} from '@/app/(timeline)/fitness/gear/gearUi'
import { useGearTableColumns } from '@/app/(timeline)/fitness/gear/useGearTableColumns'
import {
  createFitnessGearComponent,
  deleteFitnessGearComponent,
  replaceFitnessGearComponent
} from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { Select } from '@/lib/components/ui/select'
import type { GearComponentEntity } from '@/lib/services/fitness-gears/gearEntities'
import { cn } from '@/lib/utils'

interface Props {
  gearId: string
  components: GearComponentEntity[]
  /** Refetch the gear and its components — distances are derived server-side. */
  onChanged: () => void
}

const SERVICE_REMINDER_KM_OPTIONS = [1000, 3000, 5000, 8000, 12000]

/**
 * The pinned column has to paint an opaque background of its own — the rows are
 * transparent over the card, so without one the data columns scroll visibly
 * underneath it — and draws its right-hand rule as an inset shadow rather than
 * a border, because a border would scroll with the cell's box on some engines.
 */
const PINNED_CELL =
  'sticky left-0 wrap-anywhere bg-background shadow-[inset_-1px_0_0_var(--border)]'

/**
 * The row's type scale lives on the cell, not on an inner span: a `<td>` left
 * at the inherited 16px keeps a 24px strut in its line box, so its text sits
 * ~3px below the 13px cells beside it and the row grows to match. Same reason
 * the wear bar and the row actions set their own smaller sizes on the elements
 * that own them.
 *
 * `wrap-anywhere` is here for the same reason it is on the pinned cell, and it
 * matters most for the free-text brand and model: a `<td>`'s width is advisory,
 * so a long unbroken value widens its column past the snap interval, and under
 * `scroll-snap-type: x mandatory` the scroller cannot rest between snap points
 * — the tail of that cell simply cannot be scrolled to.
 */
const CELL = 'px-3 py-2.5 align-top text-[13px] wrap-anywhere'

/** Width the pinned "Type" column keeps, and the snap offset that follows it. */
const TYPE_COLUMN_WIDTH = 104

/**
 * A row action is the design system's bare text link, but a 16px line of text
 * is a target well under the WCAG 2.2 minimum of 24x24 on the phone layout this
 * table is built for. The padding buys the hit area back and the matching
 * negative margin cancels it out visually, so the label still sits on the first
 * line of the row and the row's height does not change. It matters most for
 * Delete: a tap that misses also blurs the button, and that disarms the pending
 * confirmation.
 */
const ROW_ACTION = 'h-auto -mx-2 -my-1.5 px-2 py-1.5 text-xs'

type AddedMode = 'beginning' | 'date'

const WearBar: FC<{ component: GearComponentEntity }> = ({ component }) => {
  const wear = getWearState(
    component.distanceMeters,
    component.serviceDistanceMeters
  )
  if (!wear) return null

  // Bar and caption share one line, right-aligned under the distance, so the
  // pair reads as one value however narrow the column gets.
  return (
    <div className="mt-1 flex items-center justify-end gap-2">
      {/* `aria-valuenow` has to stay inside the min/max, so an overdue
          component reports 100 there and its real wear in `aria-valuetext`. */}
      <div
        role="progressbar"
        aria-label={`${component.componentType} wear`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(wear.barPercent)}
        aria-valuetext={`${Math.round(wear.percent)}% of service interval`}
        className="h-1 w-20 shrink-0 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn('h-full rounded-full', wear.barClassName)}
          style={{ width: wear.barWidth }}
        />
      </div>
      <span className={cn('text-[11px] tabular-nums', wear.captionClassName)}>
        {wear.caption}
      </span>
    </div>
  )
}

export const GearComponentsCard: FC<Props> = ({
  gearId,
  components,
  onChanged
}) => {
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [showReplaced, setShowReplaced] = useState(false)
  const [componentType, setComponentType] = useState<string>(
    COMPONENT_TYPE_OPTIONS[0]
  )
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [addedMode, setAddedMode] = useState<AddedMode>('beginning')
  const [addedDate, setAddedDate] = useState('')
  const [serviceKm, setServiceKm] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  // A second click on the same row's Delete confirms it — cheaper than a
  // dialog for a row the user just replaced, and still not a single misclick.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null
  )
  const {
    ref: scrollerRef,
    pinnedColumnStyle,
    dataColumnStyle,
    scrollerStyle
  } = useGearTableColumns(TYPE_COLUMN_WIDTH)

  const installed = components.filter((component) => !component.removedAt)
  const replaced = components.filter((component) => component.removedAt)
  const visible = showReplaced ? [...installed, ...replaced] : installed

  const resetForm = () => {
    setComponentType(COMPONENT_TYPE_OPTIONS[0])
    setBrand('')
    setModel('')
    setAddedMode('beginning')
    setAddedDate('')
    setServiceKm('')
    setError(null)
  }

  const closeForm = () => {
    setIsFormOpen(false)
    resetForm()
  }

  // A real form submit, so Enter in Brand or Model saves the component the way
  // it does in `GearFormDialog`.
  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setIsSaving(true)
    const addedAtMs =
      addedMode === 'date' && addedDate
        ? new Date(addedDate).getTime()
        : undefined

    try {
      await createFitnessGearComponent(gearId, {
        componentType,
        brand: brand.trim() || null,
        model: model.trim() || null,
        addedAt: Number.isFinite(addedAtMs) ? addedAtMs : undefined,
        serviceDistanceMeters: serviceKm ? Number(serviceKm) * 1000 : null
      })
      closeForm()
      onChanged()
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to save component.'
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleReplace = async (componentId: string) => {
    setError(null)
    setPendingActionId(componentId)
    try {
      await replaceFitnessGearComponent(gearId, componentId)
      onChanged()
    } catch (replaceError) {
      setError(
        replaceError instanceof Error
          ? replaceError.message
          : 'Failed to replace component.'
      )
    } finally {
      setPendingActionId(null)
    }
  }

  const handleDelete = async (componentId: string) => {
    if (confirmingDeleteId !== componentId) {
      setConfirmingDeleteId(componentId)
      return
    }

    setError(null)
    setPendingActionId(componentId)
    try {
      await deleteFitnessGearComponent(gearId, componentId)
      setConfirmingDeleteId(null)
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
    // The design system's gear surfaces sit on the page background rather than
    // the card grey, which is what the stat tiles above this one use — the two
    // are meant to read as different depths, not the same slab twice.
    // Opaque, not the `bg-background/80` the other design-system sections use:
    // the pinned column has to paint an opaque background of its own, and a
    // translucent surface around it would let the page's fixed radial tints
    // through everywhere except that one column.
    //
    // `overflow-hidden` is what keeps the table inside the rounded corners: with
    // no replaced components the scroller is the section's last child, and the
    // pinned cell's opaque square background painted straight over the
    // bottom-left arc (as did the horizontal scrollbar, across both corners).
    <section className="overflow-hidden rounded-2xl border bg-background shadow-sm">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 items-center gap-2">
          <Wrench className="size-4 shrink-0 text-primary" />
          {/* The installed count is not repeated here: the stat grid above the
              card already carries it as "Components installed". */}
          <h2 className="truncate text-base font-semibold tracking-tight">
            Components
          </h2>
        </div>
        <Button variant="outline" size="sm" onClick={() => setIsFormOpen(true)}>
          <Plus />
          Add component
        </Button>
      </div>

      {error && <p className="px-5 pb-2 text-sm text-destructive">{error}</p>}

      {isFormOpen && (
        <form
          onSubmit={handleSave}
          aria-label="Add component"
          className="mx-5 mb-4 space-y-4 rounded-xl border bg-card p-4"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="component-type">Component type</Label>
              <Select
                id="component-type"
                value={componentType}
                onChange={(event) => setComponentType(event.target.value)}
                disabled={isSaving}
              >
                {COMPONENT_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="component-brand">Brand</Label>
              <Input
                id="component-brand"
                value={brand}
                onChange={(event) => setBrand(event.target.value)}
                disabled={isSaving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="component-model">Model</Label>
              <Input
                id="component-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                disabled={isSaving}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="component-added">Added on</Label>
              <Select
                id="component-added"
                value={addedMode}
                onChange={(event) =>
                  setAddedMode(event.target.value as AddedMode)
                }
                disabled={isSaving}
              >
                <option value="beginning">Since beginning</option>
                <option value="date">Specify date</option>
              </Select>
              {addedMode === 'date' && (
                <Input
                  type="date"
                  aria-label="Added date"
                  value={addedDate}
                  onChange={(event) => setAddedDate(event.target.value)}
                  disabled={isSaving}
                />
              )}
              <p className="text-xs text-muted-foreground">
                Distance counts from this date.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="component-service">Service reminder</Label>
              <Select
                id="component-service"
                value={serviceKm}
                onChange={(event) => setServiceKm(event.target.value)}
                disabled={isSaving}
              >
                <option value="">No reminder</option>
                {SERVICE_REMINDER_KM_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {formatKmInt(option * 1000)}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Optional — notify at this distance.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={isSaving}>
              Save component
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={closeForm}
              disabled={isSaving}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {visible.length === 0 ? (
        <p className="px-5 pb-6 text-sm text-muted-foreground">
          No components yet. Add the parts you want to track and each one
          accrues distance from its added date.
        </p>
      ) : (
        // Below `GEAR_TABLE_SNAP_WIDTH` this scrolls one column per swipe with
        // "Type" pinned, so the row never loses its label — see
        // `useGearTableColumns`.
        <div
          ref={scrollerRef}
          className="overflow-x-auto pb-1"
          style={scrollerStyle}
        >
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="text-xs font-medium text-muted-foreground">
                <th
                  className={cn(PINNED_CELL, 'z-[2] px-3 pb-2 font-medium')}
                  style={pinnedColumnStyle}
                >
                  Type
                </th>
                <th className="px-3 pb-2 font-medium" style={dataColumnStyle()}>
                  Brand
                </th>
                <th className="px-3 pb-2 font-medium" style={dataColumnStyle()}>
                  Model
                </th>
                <th
                  className="px-3 pb-2 text-right font-medium"
                  style={dataColumnStyle()}
                >
                  Distance
                </th>
                <th className="px-3 pb-2 font-medium" style={dataColumnStyle()}>
                  Added
                </th>
                <th className="px-3 pb-2 font-medium" style={dataColumnStyle()}>
                  Removed
                </th>
                <th className="px-3 pb-2" style={dataColumnStyle()} />
              </tr>
            </thead>
            <tbody>
              {visible.map((component) => {
                const isReplaced = Boolean(component.removedAt)
                const isPending = pendingActionId === component.id
                // A replaced row dims its contents rather than itself: the
                // opacity belongs to the values, and applying it to the row
                // would take the pinned cell's background down with it and let
                // the other columns scroll through it.
                const dim = isReplaced && 'opacity-60'
                return (
                  <tr key={component.id} className="border-t">
                    <td
                      className={cn(CELL, PINNED_CELL, 'z-[1]')}
                      style={pinnedColumnStyle}
                    >
                      <span className={cn('font-medium', dim)}>
                        {component.componentType}
                      </span>
                    </td>
                    {/* Brand keeps the row's own colour and model steps back
                        to muted, the way the design system's row does — the
                        pair reads as one value with an emphasis, not as two
                        equally weighted columns. */}
                    <td className={cn(CELL, dim)} style={dataColumnStyle(96)}>
                      {component.brand || '—'}
                    </td>
                    <td
                      className={cn(CELL, 'text-muted-foreground', dim)}
                      style={dataColumnStyle(132)}
                    >
                      {component.model || '—'}
                    </td>
                    <td
                      className={cn(CELL, 'whitespace-nowrap text-right', dim)}
                      style={dataColumnStyle(108)}
                    >
                      <span className="font-semibold tabular-nums">
                        {formatGearDistanceKm(component.distanceMeters)}
                      </span>
                      {/* Only while the part is fitted: wear against a service
                          interval is advice about what to do next, and there is
                          nothing left to do about a component already off the
                          bike. */}
                      {!isReplaced && <WearBar component={component} />}
                    </td>
                    <td
                      className={cn(
                        CELL,
                        'whitespace-nowrap text-muted-foreground',
                        dim
                      )}
                      style={dataColumnStyle(112)}
                    >
                      {component.addedAt
                        ? formatGearDate(component.addedAt)
                        : 'Since beginning'}
                    </td>
                    <td
                      className={cn(
                        CELL,
                        'whitespace-nowrap text-muted-foreground',
                        dim
                      )}
                      style={dataColumnStyle(88)}
                    >
                      {component.removedAt
                        ? formatGearDate(component.removedAt)
                        : '—'}
                    </td>
                    <td
                      className={cn(CELL, 'whitespace-nowrap text-right')}
                      style={dataColumnStyle(84)}
                    >
                      {isReplaced ? (
                        <Button
                          size="sm"
                          type="button"
                          variant="link"
                          className={cn(ROW_ACTION, 'text-destructive')}
                          disabled={isPending}
                          onClick={() => handleDelete(component.id)}
                          // Leaving the button disarms it: an armed row that
                          // stays armed is a destructive single click waiting
                          // for whoever comes back to this table.
                          onBlur={() => {
                            if (confirmingDeleteId === component.id) {
                              setConfirmingDeleteId(null)
                            }
                          }}
                        >
                          {confirmingDeleteId === component.id
                            ? 'Confirm delete'
                            : 'Delete'}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          type="button"
                          variant="link"
                          className={ROW_ACTION}
                          disabled={isPending}
                          onClick={() => handleReplace(component.id)}
                        >
                          Replace
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {replaced.length > 0 && (
        <div className="border-t px-5 py-3">
          <button
            type="button"
            className="cursor-pointer text-xs font-medium text-primary hover:underline"
            // Hiding the replaced rows must disarm any pending confirmation
            // with them: the armed row would otherwise come back armed and
            // delete on the first click after the next "Show ...".
            onClick={() => {
              setShowReplaced((current) => !current)
              setConfirmingDeleteId(null)
            }}
          >
            {showReplaced
              ? 'Hide replaced components'
              : `Show ${replaced.length} replaced component${
                  replaced.length === 1 ? '' : 's'
                }`}
          </button>
        </div>
      )}
    </section>
  )
}
