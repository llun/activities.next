'use client'

import { Globe, MapPin, Maximize, Pencil, Trash2 } from 'lucide-react'
import { FC, PointerEvent as ReactPointerEvent, useRef, useState } from 'react'

import { WORLD_LAND_PATH } from '@/lib/components/fitness/worldMapPath'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import {
  HeatmapRegion,
  LatLng,
  MAX_HEATMAP_REGIONS,
  RectRegion,
  formatLatitude,
  formatLongitude,
  formatRectRegion,
  isValidRect
} from '@/lib/fitness/regions'
import { cn } from '@/lib/utils'

/** A region plus a stable client id for list keys and edit targeting. */
export type PickerRegion = HeatmapRegion & { id: string }

let regionUid = 0
const createRegionId = (): string =>
  `r${Date.now().toString(36)}${(regionUid++).toString(36)}`

/** Strips the client-only id (and other UI fields) for serialization. */
export const toHeatmapRegion = (region: PickerRegion): HeatmapRegion =>
  region.type === 'world'
    ? { type: 'world' }
    : { type: 'rect', name: region.name, nw: region.nw, se: region.se }

/** Attaches client ids to a deserialized region list (e.g. when loading a job). */
export const withRegionIds = (regions: HeatmapRegion[]): PickerRegion[] =>
  regions.map((region) => ({ ...region, id: createRegionId() }))

const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, value))

// Build a normalized box (nw = top-left, se = bottom-right) from any two points.
const boxFrom = (a: LatLng, b: LatLng): { nw: LatLng; se: LatLng } => ({
  nw: { lat: Math.max(a.lat, b.lat), lng: Math.min(a.lng, b.lng) },
  se: { lat: Math.min(a.lat, b.lat), lng: Math.max(a.lng, b.lng) }
})

const DEFAULT_BOX: { nw: LatLng; se: LatLng } = {
  nw: { lat: 53, lng: 3 },
  se: { lat: 50, lng: 7 }
}

const LNG_LINES = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150]
const LAT_LINES = [-60, -30, 0, 30, 60]

interface BBoxMapProps {
  box: { nw: LatLng; se: LatLng }
  onChange: (box: { nw: LatLng; se: LatLng }) => void
  height?: number
}

// Equirectangular projection: x ∈ [0,1] ↔ lng [-180,180], y ∈ [0,1] ↔ lat [90,-90]
const BBoxMap: FC<BBoxMapProps> = ({ box, onChange, height = 230 }) => {
  const ref = useRef<HTMLDivElement | null>(null)
  const startRef = useRef<LatLng | null>(null)

  const geoAt = (event: ReactPointerEvent<HTMLDivElement>): LatLng => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return { lat: 0, lng: 0 }
    // Guard against a zero-size box (hidden/not-yet-laid-out) producing NaN.
    const width = rect.width || 1
    const height = rect.height || 1
    const x = clamp((event.clientX - rect.left) / width, 0, 1)
    const y = clamp((event.clientY - rect.top) / height, 0, 1)
    // Round to the same 2-dp precision used by the inputs and serialization so
    // dragged coordinates match the displayed/stored values exactly.
    return {
      lng: Number((x * 360 - 180).toFixed(2)),
      lat: Number((90 - y * 180).toFixed(2))
    }
  }

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const point = geoAt(event)
    startRef.current = point
    try {
      ref.current?.setPointerCapture(event.pointerId)
    } catch {
      // setPointerCapture can throw in jsdom; the drag still works.
    }
    onChange(boxFrom(point, point))
  }
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return
    onChange(boxFrom(startRef.current, geoAt(event)))
  }
  const onUp = () => {
    startRef.current = null
  }

  const left = (box.nw.lng + 180) / 360
  const top = (90 - box.nw.lat) / 180
  const right = (box.se.lng + 180) / 360
  const bottom = (90 - box.se.lat) / 180

  return (
    <div
      ref={ref}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role="application"
      aria-label="Select an area on the map"
      className="relative w-full cursor-crosshair touch-none select-none overflow-hidden rounded-lg border bg-sky-100 dark:bg-slate-800"
      style={{ height }}
    >
      <svg
        viewBox="0 0 360 180"
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        className="absolute inset-0 block"
        aria-hidden="true"
      >
        {/* Simplified Natural Earth land outline so the surface reads as a real
            map instead of a bare grid. */}
        <path
          d={WORLD_LAND_PATH}
          className="fill-emerald-200/90 stroke-emerald-300/60 dark:fill-slate-600/80 dark:stroke-slate-500/50"
          strokeWidth="0.3"
        />
        <g
          className="stroke-slate-400/40 dark:stroke-slate-500/40"
          strokeWidth="0.5"
        >
          {LNG_LINES.map((value) => (
            <line
              key={`x${value}`}
              x1={value + 180}
              y1="0"
              x2={value + 180}
              y2="180"
            />
          ))}
          {LAT_LINES.map((value) => (
            <line
              key={`y${value}`}
              x1="0"
              y1={90 - value}
              x2="360"
              y2={90 - value}
            />
          ))}
        </g>
        <g
          className="stroke-slate-400/60 dark:stroke-slate-500/60"
          strokeWidth="0.8"
        >
          <line x1="0" y1="90" x2="360" y2="90" />
          <line x1="180" y1="0" x2="180" y2="180" />
        </g>
        <rect
          x="0"
          y="0"
          width="360"
          height="180"
          fill="none"
          className="stroke-slate-400/50 dark:stroke-slate-500/50"
          strokeWidth="1"
        />
      </svg>

      <div
        className="pointer-events-none absolute border-[1.5px] border-primary bg-primary/20"
        style={{
          left: `${left * 100}%`,
          top: `${top * 100}%`,
          width: `${Math.max(0, right - left) * 100}%`,
          height: `${Math.max(0, bottom - top) * 100}%`
        }}
      >
        {[
          '-top-1 -left-1',
          '-top-1 -right-1',
          '-bottom-1 -left-1',
          '-bottom-1 -right-1'
        ].map((corner) => (
          <span
            key={corner}
            className={cn(
              'absolute h-2 w-2 rounded-full border-[1.5px] border-primary bg-white',
              corner
            )}
          />
        ))}
      </div>

      <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
        TL · {formatLatitude(box.nw.lat)} {formatLongitude(box.nw.lng)}
      </span>
      <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
        BR · {formatLatitude(box.se.lat)} {formatLongitude(box.se.lng)}
      </span>
    </div>
  )
}

interface CoordFieldProps {
  label: string
  /** Full accessible name (e.g. "Top-left latitude"); falls back to `label`. */
  srLabel?: string
  value: number
  min: number
  max: number
  suffix: string
  onChange: (value: number) => void
}

const formatCoordInput = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(2) : ''

// Allows the empty string, a lone "-", and partial decimals ("5", "5.", "-5.2")
// so the value stays typeable; the final number is parsed/clamped on commit.
const PARTIAL_DECIMAL = /^-?[0-9]*\.?[0-9]*$/

const CoordField: FC<CoordFieldProps> = ({
  label,
  srLabel,
  value,
  min,
  max,
  suffix,
  onChange
}) => {
  // Edit as a free-form string so partial input ("-", "5.") is typeable, and
  // only commit the parsed/clamped number on blur or Enter — committing on every
  // keystroke would clamp mid-typing and jerk the map view. A text input (not
  // type="number") is used because native number inputs silently drop partial
  // values like "-" or "5." from `event.target.value`.
  const [draft, setDraft] = useState(() => formatCoordInput(value))
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setDraft(formatCoordInput(value))
  }

  const commit = () => {
    const parsed = parseFloat(draft)
    if (Number.isNaN(parsed)) {
      setDraft(formatCoordInput(value))
      return
    }
    // Round before propagating so the parent state matches the displayed 2-dp
    // value (and the precision used by serialization/validation) exactly.
    const rounded = Number(clamp(parsed, min, max).toFixed(2))
    setDraft(rounded.toFixed(2))
    onChange(rounded)
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="relative">
        <Input
          type="text"
          inputMode="decimal"
          aria-label={srLabel ?? label}
          value={draft}
          onChange={(event) => {
            const next = event.target.value
            if (PARTIAL_DECIMAL.test(next)) setDraft(next)
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
          }}
          className="h-8 pr-7"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
          {suffix}
        </span>
      </span>
    </label>
  )
}

interface RectComposerProps {
  initial?: RectRegion | null
  onCancel: () => void
  onSave: (rect: RectRegion) => void
}

const RectComposer: FC<RectComposerProps> = ({ initial, onCancel, onSave }) => {
  const [box, setBox] = useState<{ nw: LatLng; se: LatLng }>(
    initial ? { nw: { ...initial.nw }, se: { ...initial.se } } : DEFAULT_BOX
  )
  const [name, setName] = useState(initial?.name ?? '')
  const setCorner = (corner: 'nw' | 'se', key: 'lat' | 'lng', value: number) =>
    setBox((current) => ({
      ...current,
      [corner]: { ...current[corner], [key]: value }
    }))
  const valid = isValidRect({ type: 'rect', nw: box.nw, se: box.se })

  return (
    <div className="rounded-lg border bg-background p-3">
      <label className="mb-3 flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Area name{' '}
          <span className="font-normal normal-case text-muted-foreground/70">
            (optional)
          </span>
        </span>
        <Input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Veluwe loop"
          maxLength={80}
        />
      </label>

      <BBoxMap box={box} onChange={setBox} />

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
        <div className="col-span-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <MapPin className="size-3" /> Top-left (NW)
        </div>
        <CoordField
          label="Latitude"
          srLabel="Top-left latitude"
          value={box.nw.lat}
          min={-90}
          max={90}
          suffix="°N"
          onChange={(value) => setCorner('nw', 'lat', value)}
        />
        <CoordField
          label="Longitude"
          srLabel="Top-left longitude"
          value={box.nw.lng}
          min={-180}
          max={180}
          suffix="°E"
          onChange={(value) => setCorner('nw', 'lng', value)}
        />
        <div className="col-span-2 mt-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <MapPin className="size-3" /> Bottom-right (SE)
        </div>
        <CoordField
          label="Latitude"
          srLabel="Bottom-right latitude"
          value={box.se.lat}
          min={-90}
          max={90}
          suffix="°N"
          onChange={(value) => setCorner('se', 'lat', value)}
        />
        <CoordField
          label="Longitude"
          srLabel="Bottom-right longitude"
          value={box.se.lng}
          min={-180}
          max={180}
          suffix="°E"
          onChange={(value) => setCorner('se', 'lng', value)}
        />
      </div>

      {!valid && (
        <p className="mt-2 text-[11px] text-destructive">
          Top-left must be north-west of bottom-right.
        </p>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!valid}
          onClick={() =>
            onSave({
              type: 'rect',
              name: name.trim() || undefined,
              nw: box.nw,
              se: box.se
            })
          }
        >
          {initial ? 'Save area' : 'Add area'}
        </Button>
      </div>
    </div>
  )
}

interface RegionRowProps {
  region: PickerRegion
  onEdit: () => void
  onRemove: () => void
}

const RegionRow: FC<RegionRowProps> = ({ region, onEdit, onRemove }) => {
  const isWorld = region.type === 'world'
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-background p-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {isWorld ? (
          <Globe className="size-4" />
        ) : (
          <Maximize className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {isWorld ? 'Whole world' : region.name || 'Map area'}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {isWorld
            ? 'Entire globe — every recorded activity'
            : formatRectRegion(region)}
        </div>
      </div>
      {!isWorld && (
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit area"
          className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Pencil className="size-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={isWorld ? 'Remove region' : 'Remove area'}
        className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}

interface HeatmapRegionPickerProps {
  value: PickerRegion[]
  onChange: (regions: PickerRegion[]) => void
}

interface ComposerState {
  editId: string | null
}

export const HeatmapRegionPicker: FC<HeatmapRegionPickerProps> = ({
  value,
  onChange
}) => {
  const [composer, setComposer] = useState<ComposerState | null>(null)
  const hasWorld = value.some((region) => region.type === 'world')
  const atLimit = value.length >= MAX_HEATMAP_REGIONS

  // The whole world subsumes any rectangles (serializeRegions collapses
  // world + rects to world), so the two kinds are mutually exclusive: picking
  // the world replaces the list, and drawing a rectangle drops the world.
  const addWorld = () => {
    if (hasWorld) return
    onChange([{ id: createRegionId(), type: 'world' }])
  }
  const removeRegion = (id: string) =>
    onChange(value.filter((region) => region.id !== id))

  const saveRect = (rect: RectRegion) => {
    const withoutWorld = value.filter((region) => region.type !== 'world')
    if (composer?.editId) {
      onChange(
        withoutWorld.map((region) =>
          region.id === composer.editId
            ? { ...region, ...rect, id: region.id }
            : region
        )
      )
    } else {
      onChange([...withoutWorld, { id: createRegionId(), ...rect }])
    }
    setComposer(null)
  }

  const editingRegion =
    composer?.editId != null
      ? value.find((region) => region.id === composer.editId)
      : null
  const editingRect =
    editingRegion && editingRegion.type === 'rect' ? editingRegion : null

  return (
    <div className="space-y-2.5">
      {value.length > 0 && (
        <div className="space-y-1.5">
          {value.map((region) => (
            <RegionRow
              key={region.id}
              region={region}
              onEdit={() => setComposer({ editId: region.id })}
              onRemove={() => removeRegion(region.id)}
            />
          ))}
        </div>
      )}

      {value.length === 0 && !composer && (
        <div className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          No regions yet — add the whole world, or select an area on the map.
        </div>
      )}

      {composer ? (
        <RectComposer
          initial={editingRect}
          onCancel={() => setComposer(null)}
          onSave={saveRect}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addWorld}
            disabled={hasWorld}
          >
            <Globe className="size-3.5" /> Whole world
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setComposer({ editId: null })}
            disabled={atLimit}
          >
            <Maximize className="size-3.5" /> Select an area
          </Button>
        </div>
      )}

      {atLimit && !composer && (
        <p className="text-[11px] text-muted-foreground">
          Up to {MAX_HEATMAP_REGIONS} regions per heatmap.
        </p>
      )}
    </div>
  )
}
