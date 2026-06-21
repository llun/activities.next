'use client'

import { Globe, MapPin, Maximize, Pencil, Trash2 } from 'lucide-react'
import { FC, useMemo, useState } from 'react'

import { GlModule, RegionMap } from '@/lib/components/fitness/RegionMap'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import {
  HeatmapRegion,
  LatLng,
  MAX_HEATMAP_REGIONS,
  RectRegion,
  formatRectRegion,
  isValidRect
} from '@/lib/fitness/regions'
import { loadMapboxModule } from '@/lib/utils/mapbox'
import { OPENFREEMAP_STYLE_URL, loadMaplibreModule } from '@/lib/utils/maplibre'

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
  /** Public Mapbox token; when absent the free MapLibre/OpenFreeMap map is used. */
  mapboxAccessToken?: string
  onCancel: () => void
  onSave: (rect: RectRegion) => void
}

const RectComposer: FC<RectComposerProps> = ({
  initial,
  mapboxAccessToken,
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
  const mapProvider = useMemo(
    () =>
      mapboxAccessToken
        ? {
            loadModule: () => loadMapboxModule<GlModule>(),
            mapOptions: {
              style: 'mapbox://styles/mapbox/outdoors-v12',
              accessToken: mapboxAccessToken
            },
            providerLabel: 'Mapbox'
          }
        : {
            loadModule: () => loadMaplibreModule<GlModule>(),
            mapOptions: { style: OPENFREEMAP_STYLE_URL },
            providerLabel: 'OpenFreeMap'
          },
    [mapboxAccessToken]
  )

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
          loadModule={mapProvider.loadModule}
          mapOptions={mapProvider.mapOptions}
          providerLabel={mapProvider.providerLabel}
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
  /** Public Mapbox token; when absent the free MapLibre/OpenFreeMap map is used. */
  mapboxAccessToken?: string
}

interface ComposerState {
  editId: string | null
}

export const HeatmapRegionPicker: FC<HeatmapRegionPickerProps> = ({
  value,
  onChange,
  mapboxAccessToken
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
          No regions yet — add the whole world, or select an area on a map.
        </div>
      )}

      {composer ? (
        <RectComposer
          initial={editingRect}
          mapboxAccessToken={mapboxAccessToken}
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
