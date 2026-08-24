'use client'

import { Plus, Wrench } from 'lucide-react'
import { FC, FormEvent, useState } from 'react'

import {
  COMPONENT_TYPE_OPTIONS,
  STICKY_COLUMN,
  formatGearDate,
  formatGearDistanceKm,
  formatKmInt,
  getWearState
} from '@/app/(timeline)/fitness/gear/gearUi'
import { useGearTableColumns } from '@/app/(timeline)/fitness/gear/useGearTableColumns'
import {
  createFitnessGearComponent,
  deleteFitnessGearComponent,
  retireFitnessGearComponent
} from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import { Card } from '@/lib/components/ui/card'
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
 * A long unbroken component type, brand or model would otherwise widen its
 * column past the width below — a `<td>`'s width is advisory — and under
 * `scroll-snap-type: x mandatory` a column wider than its snap interval has a
 * tail the scroller can never come to rest on. All three are free text to 255
 * characters (`gearRequests.ts`), so none of them can be trusted to be short.
 */
const CELL_WRAP = 'wrap-anywhere'

type AddedMode = 'beginning' | 'date'

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
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [showRetired, setShowRetired] = useState(false)
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
  // dialog for a row the user just retired, and still not a single misclick.
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
  const retired = components.filter((component) => component.removedAt)
  const visible = showRetired ? [...installed, ...retired] : installed

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

  const handleRetire = async (componentId: string) => {
    setError(null)
    setPendingActionId(componentId)
    try {
      await retireFitnessGearComponent(gearId, componentId)
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
    <Card className="gap-4 py-4">
      <div className="flex flex-wrap items-center gap-2 px-4">
        <Wrench className="size-4 text-primary" />
        <h2 className="text-base font-medium">Components</h2>
        <span className="text-sm text-muted-foreground">
          {installed.length} installed
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => setIsFormOpen(true)}
        >
          <Plus />
          Add component
        </Button>
      </div>

      {error && <p className="px-4 text-sm text-destructive">{error}</p>}

      {isFormOpen && (
        <form
          onSubmit={handleSave}
          aria-label="Add component"
          className="mx-4 space-y-3 rounded-md border bg-muted/50 p-3"
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
        <p className="px-4 text-sm text-muted-foreground">
          No components yet. Add the parts you want to track and each one
          accrues distance from its added date.
        </p>
      ) : (
        // Below `GEAR_TABLE_SNAP_WIDTH` this scrolls one column per swipe with
        // "Type" pinned; above it the columns share the row as before. The old
        // `min-w-[720px]` is gone because the per-cell minimums below already
        // add up to it — it only ever forced the wide layout onto phones.
        <div
          ref={scrollerRef}
          className="overflow-x-auto"
          style={scrollerStyle}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-muted-foreground">
                <th
                  className={cn(STICKY_COLUMN, 'px-4 pb-2 font-medium')}
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
                  Retired
                </th>
                <th
                  className="px-3 pr-4 pb-2 font-medium"
                  style={dataColumnStyle()}
                />
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
                        'px-4 py-2.5 align-top font-medium'
                      )}
                      style={pinnedColumnStyle}
                    >
                      <div className={cn(isRetired && 'opacity-60')}>
                        {component.componentType}
                      </div>
                    </td>
                    <td
                      className={cn(
                        CELL_WRAP,
                        'px-3 py-2.5 align-top text-muted-foreground',
                        isRetired && 'opacity-60'
                      )}
                      style={dataColumnStyle(96)}
                    >
                      {component.brand || '—'}
                    </td>
                    <td
                      className={cn(
                        CELL_WRAP,
                        'px-3 py-2.5 align-top text-muted-foreground',
                        isRetired && 'opacity-60'
                      )}
                      style={dataColumnStyle(132)}
                    >
                      {component.model || '—'}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2.5 text-right align-top whitespace-nowrap',
                        isRetired && 'opacity-60'
                      )}
                      style={dataColumnStyle(108)}
                    >
                      <span className="font-semibold tabular-nums">
                        {formatGearDistanceKm(component.distanceMeters)}
                      </span>
                      <WearBar component={component} />
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2.5 align-top whitespace-nowrap text-muted-foreground',
                        isRetired && 'opacity-60'
                      )}
                      style={dataColumnStyle(112)}
                    >
                      {component.addedAt
                        ? formatGearDate(component.addedAt)
                        : 'Since beginning'}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2.5 align-top whitespace-nowrap text-muted-foreground',
                        isRetired && 'opacity-60'
                      )}
                      style={dataColumnStyle(88)}
                    >
                      {component.removedAt
                        ? formatGearDate(component.removedAt)
                        : '—'}
                    </td>
                    <td
                      className="px-3 py-2.5 pr-4 text-right align-top whitespace-nowrap"
                      style={dataColumnStyle(84)}
                    >
                      {isRetired ? (
                        <Button
                          size="sm"
                          type="button"
                          variant="ghost"
                          className="text-destructive"
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
                          variant="ghost"
                          className="text-primary-text"
                          aria-label={`Retire ${component.componentType}`}
                          disabled={isPending}
                          onClick={() => handleRetire(component.id)}
                        >
                          Retire
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

      {retired.length > 0 && (
        <div className="px-4">
          <button
            type="button"
            className="cursor-pointer text-xs font-medium text-primary-text hover:underline"
            // Hiding the retired rows must disarm any pending confirmation
            // with them: the armed row would otherwise come back armed and
            // delete on the first click after the next "Show ...".
            onClick={() => {
              setShowRetired((current) => !current)
              setConfirmingDeleteId(null)
            }}
          >
            {showRetired
              ? 'Hide retired components'
              : `Show ${retired.length} retired component${
                  retired.length === 1 ? '' : 's'
                }`}
          </button>
        </div>
      )}
    </Card>
  )
}
