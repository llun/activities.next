'use client'

import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clock,
  Globe,
  Loader2,
  MapPin,
  Maximize,
  Pencil,
  Trash2
} from 'lucide-react'
import { FC, useMemo, useState } from 'react'

import { GlModule, RegionMap } from '@/lib/components/fitness/RegionMap'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import {
  HeatmapRegion,
  LatLng,
  RectRegion,
  formatRectRegion,
  isValidRect,
  serializeRegion
} from '@/lib/fitness/regions'
import { cn } from '@/lib/utils'
import {
  type PublicMapProvider,
  buildGlProviderOptions
} from '@/lib/utils/mapProvider'

/** A region plus a stable client id for list keys and edit targeting. */
export type PickerRegion = HeatmapRegion & { id: string }

/**
 * Per-region generation state, derived by the orchestrator from the heatmap that
 * matches the region under the current activity/period source. Each region owns
 * its own heatmap (one kept version), so the row surfaces that region's status.
 */
export type RegionDisplayState =
  'idle' | 'pending' | 'generating' | 'completed' | 'partial' | 'failed'

export interface RegionDisplayStatus {
  state: RegionDisplayState
  /** 0–100 while generating, or null when the total is not yet known. */
  progressPercent?: number | null
  /** Pre-formatted relative time (e.g. "2h ago") for completed/partial rows. */
  generatedLabel?: string | null
}

// TODO(apple-maps): Apple renders through MapKit JS, not a GL engine. Until the
// dedicated MapKit renderer lands (the MapKit-renderers task), fall back to the
// keyless OpenFreeMap GL map so an Apple-configured instance can still draw a
// region. That task replaces this branch.
const toGlProvider = (
  provider: PublicMapProvider
): Exclude<PublicMapProvider, { type: 'apple' }> =>
  provider.type === 'apple' ? { type: 'osm' } : provider

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

/** Keeps the first region for each canonical heatmap key, dropping later dupes. */
const dedupeByRegionKey = (regions: PickerRegion[]): PickerRegion[] => {
  const seen = new Set<string>()
  return regions.filter((region) => {
    const key = serializeRegion(toHeatmapRegion(region))
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, value))

const DEFAULT_BOX: { nw: LatLng; se: LatLng } = {
  nw: { lat: 53, lng: 3 },
  se: { lat: 50, lng: 7 }
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
  /** Which map backend renders the draw surface. */
  mapProvider: PublicMapProvider
  onCancel: () => void
  onSave: (rect: RectRegion) => void
}

const RectComposer: FC<RectComposerProps> = ({
  initial,
  mapProvider,
  onCancel,
  onSave
}) => {
  const [box, setBox] = useState<{ nw: LatLng; se: LatLng }>(
    initial ? { nw: { ...initial.nw }, se: { ...initial.se } } : DEFAULT_BOX
  )
  const [name, setName] = useState(initial?.name ?? '')
  const [mapUnavailable, setMapUnavailable] = useState(false)
  const setCorner = (corner: 'nw' | 'se', key: 'lat' | 'lng', value: number) =>
    setBox((current) => ({
      ...current,
      [corner]: { ...current[corner], [key]: value }
    }))
  const valid = isValidRect({ type: 'rect', nw: box.nw, se: box.se })

  // Mapbox when a token is configured; otherwise the keyless MapLibre +
  // OpenFreeMap provider. Either way a new area starts at the user's location.
  // Keyed on the descriptor's fields (not its object identity) so an inline prop
  // literal doesn't recreate the map on every parent render.
  const providerType = mapProvider.type
  const providerAccessToken =
    mapProvider.type === 'mapbox' ? mapProvider.accessToken : undefined
  const glProvider = useMemo(() => {
    const options = buildGlProviderOptions(
      toGlProvider(mapProvider),
      'outdoors'
    )
    return {
      loadModule: () => options.loadModule() as Promise<GlModule>,
      mapOptions: options.mapOptions,
      providerLabel: options.label
    }
  }, [providerType, providerAccessToken])

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

      {mapUnavailable ? (
        <div
          role="status"
          className="flex h-[120px] items-center justify-center rounded-lg border bg-muted/40 px-3 text-center text-xs text-muted-foreground"
        >
          Map unavailable — enter the corner coordinates below.
        </div>
      ) : (
        <RegionMap
          box={box}
          onChange={setBox}
          loadModule={glProvider.loadModule}
          mapOptions={glProvider.mapOptions}
          providerLabel={glProvider.providerLabel}
          centerOnUser={!initial}
          onUnavailable={() => setMapUnavailable(true)}
        />
      )}

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

/** Inline status atom for a region row — mirrors the per-region heatmap state. */
const RegionStatus: FC<{ status: RegionDisplayStatus }> = ({ status }) => {
  switch (status.state) {
    case 'generating':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400">
          <Loader2 className="size-3 animate-spin" />
          {status.progressPercent == null
            ? 'Generating…'
            : `Generating… ${status.progressPercent}%`}
        </span>
      )
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <Clock className="size-3" />
          Queued
        </span>
      )
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive">
          <AlertTriangle className="size-3" />
          Failed
        </span>
      )
    case 'partial':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-500">
          <AlertTriangle className="size-3" />
          {status.generatedLabel
            ? `Partial · ${status.generatedLabel}`
            : 'Partial'}
        </span>
      )
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-600 dark:text-green-500">
          <Check className="size-3" />
          {status.generatedLabel
            ? `Generated ${status.generatedLabel}`
            : 'Generated'}
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="size-3" />
          Not generated
        </span>
      )
  }
}

interface RegionRowProps {
  region: PickerRegion
  status?: RegionDisplayStatus | null
  onOpen?: (region: PickerRegion) => void
  onEdit: () => void
  onRemove: () => void
}

const RegionRow: FC<RegionRowProps> = ({
  region,
  status,
  onOpen,
  onEdit,
  onRemove
}) => {
  const isWorld = region.type === 'world'
  const clickable = Boolean(onOpen)
  const title = isWorld ? 'Whole world' : region.name || 'Map area'
  const subtitle = isWorld
    ? 'Entire globe — every recorded activity'
    : formatRectRegion(region)

  const content = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {isWorld ? (
          <Globe className="size-4" />
        ) : (
          <Maximize className="size-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-medium">{title}</span>
          {status && <RegionStatus status={status} />}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {subtitle}
        </span>
      </span>
    </>
  )

  return (
    <div
      className={cn(
        'group flex items-center gap-2.5 rounded-lg border bg-background p-2.5 transition-colors',
        clickable && 'hover:border-primary/50 hover:bg-primary/[0.04]'
      )}
    >
      {clickable ? (
        <button
          type="button"
          onClick={() => onOpen?.(region)}
          aria-label={`Open ${title} heatmap`}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {content}
        </div>
      )}
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
      {clickable && (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      )}
    </div>
  )
}

interface HeatmapRegionPickerProps {
  value: PickerRegion[]
  onChange: (regions: PickerRegion[]) => void
  /** Which map backend renders the draw surface. */
  mapProvider: PublicMapProvider
  /** Opens a region's own heatmap page. When omitted, rows are not clickable. */
  onOpen?: (region: PickerRegion) => void
  /** Per-region heatmap status under the current activity/period source. */
  getRegionStatus?: (region: PickerRegion) => RegionDisplayStatus | null
  /** Fired after a region leaves the list, so its cached heatmap can be pruned. */
  onRegionRemoved?: (region: PickerRegion) => void
  /**
   * Fired after a drawn area is added or edited, with the saved region (carrying
   * its current `name`). Lets the orchestrator persist the label so it survives
   * a reload instead of reverting to the generic "Map area".
   */
  onRegionSaved?: (region: PickerRegion) => void
}

interface ComposerState {
  editId: string | null
}

export const HeatmapRegionPicker: FC<HeatmapRegionPickerProps> = ({
  value,
  onChange,
  mapProvider,
  onOpen,
  getRegionStatus,
  onRegionRemoved,
  onRegionSaved
}) => {
  const [composer, setComposer] = useState<ComposerState | null>(null)
  const hasWorld = value.some((region) => region.type === 'world')

  // Each region owns its own heatmap now, so the whole world and drawn areas
  // coexist in the list — adding one no longer collapses the others.
  const addWorld = () => {
    if (hasWorld) return
    onChange([...value, { id: createRegionId(), type: 'world' }])
  }
  const removeRegion = (id: string) => {
    const removed = value.find((region) => region.id === id)
    onChange(value.filter((region) => region.id !== id))
    if (removed) onRegionRemoved?.(removed)
  }

  const saveRect = (rect: RectRegion) => {
    const savedRegion: PickerRegion = composer?.editId
      ? { ...rect, id: composer.editId }
      : { ...rect, id: createRegionId() }
    const next = composer?.editId
      ? value.map((region) =>
          region.id === composer.editId ? savedRegion : region
        )
      : [...value, savedRegion]
    // Drop regions that collapse to the same canonical key — each region owns one
    // heatmap, so a duplicate would share (and fight over) a single cache row
    // (removing one would soft-delete the cache the survivor still points at).
    const deduped = dedupeByRegionKey(next)
    onChange(deduped)
    setComposer(null)
    // Persist the label by region key (idempotent; a blank name clears it) — but
    // only when the saved region actually survived the dedupe. Otherwise a draw
    // that collapsed onto an existing region would overwrite that region's stored
    // name with the dropped draw's name (a session-vs-reload mismatch).
    if (deduped.some((region) => region.id === savedRegion.id)) {
      onRegionSaved?.(savedRegion)
    }
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
              status={getRegionStatus?.(region)}
              onOpen={onOpen}
              onEdit={() => setComposer({ editId: region.id })}
              onRemove={() => removeRegion(region.id)}
            />
          ))}
        </div>
      )}

      {value.length === 0 && !composer && (
        <div className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          No regions yet — add the whole world, or draw an area on the map.
        </div>
      )}

      {composer ? (
        <RectComposer
          initial={editingRect}
          mapProvider={mapProvider}
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
          >
            <Maximize className="size-3.5" /> Draw area on map
          </Button>
        </div>
      )}
    </div>
  )
}
