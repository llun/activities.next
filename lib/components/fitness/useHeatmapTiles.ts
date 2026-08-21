'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  FitnessRouteHeatmapBounds,
  FitnessRouteHeatmapTileBatch,
  FitnessRouteHeatmapTileRequest,
  FitnessRouteHeatmapTileSource
} from '@/lib/client'
import {
  HeatmapTileRun,
  tileRunsToLngLat
} from '@/lib/components/fitness/heatmapTileGeometry'
import {
  MAX_TILES_PER_REQUEST,
  TILE_EXTENT,
  TILE_LADDER_ZOOMS,
  TILE_MAX_ZOOM,
  TILE_MIN_ZOOM
} from '@/lib/services/fitness-files/heatmapTiles/constants'
import {
  decodeTile,
  tilesForBounds
} from '@/lib/services/fitness-files/heatmapTiles/tileCodec'

/**
 * Binds a tile request to whatever credential the surface has — the owner's
 * actor id and region, or a share token. The two fetchers in `lib/client.ts`
 * take different arguments on purpose (the public one refuses a region, because
 * the server clips to the shared row's own scope), so the component takes a
 * closure rather than trying to model both.
 */
export type HeatmapTileFetcher = (
  request: FitnessRouteHeatmapTileRequest
) => Promise<FitnessRouteHeatmapTileBatch>

export interface HeatmapViewport {
  zoom: number
  bounds: FitnessRouteHeatmapBounds
}

/**
 * The most tiles one view may ask for.
 *
 * Sized from MEASURED worst cases, because coarsening is not free: a view that
 * trips this is drawn a whole rung softer than its zoom asked for, which is the
 * simplification this feature exists to stop showing. At the least favourable
 * ladder rounding a full-bleed embed needs 273 tiles at 1280x720, 558 at
 * 1920x1080 and 984 at 2560x1440 — so anything at or below ~512 would coarsen
 * an ordinary desktop map at EVERY rung boundary rather than in some rare
 * corner. A 4K map still coarsens, and should.
 *
 * Past this a view is coarsened rather than refused: `load` steps down the
 * ladder until the count fits, which is the same trade the ladder itself makes
 * — less detail for a wider view — instead of abandoning the view and
 * stranding whatever was drawn before it.
 */
export const MAX_TILES_PER_VIEW = 1024

/**
 * How many decoded tiles to keep. Sized so panning back and forth across a
 * city, and stepping one zoom out and in again, are both free.
 *
 * **It must exceed `MAX_TILES_PER_VIEW`, and that is a correctness bound, not a
 * tuning one.** Tiles are inserted batch by batch while a view loads and
 * eviction takes the oldest first — so a cache smaller than one view would
 * evict the batches that view had already fetched and assemble a map with holes
 * it has no way to notice. Above that floor it is a memory trade: a tile is a
 * few KB of decoded runs, so this holds a viewport and a half in a few MB.
 */
export const TILE_CACHE_MAX_TILES = 2048

/** Wait for the pan or pinch to settle before spending a request on it. */
export const VIEW_SETTLE_MS = 200

/**
 * The stored zoom to draw a view at: the smallest ladder rung that is at least
 * as detailed as the view, clamped to the ladder's ends.
 *
 * Rounding UP rather than to the nearest rung means the client never magnifies
 * geometry that was simplified for a coarser zoom — a rung is simplified to one
 * pixel AT ITS OWN zoom, so drawing z12 tiles at view zoom 13 would show the
 * simplification. Past the top rung there is nothing finer to ask for, and z16
 * reused at z17 is under ~2px of error.
 */
export const storedZoomForView = (viewZoom: number): number => {
  const wanted = Math.ceil(viewZoom)
  if (wanted <= TILE_MIN_ZOOM) return TILE_MIN_ZOOM
  return TILE_LADDER_ZOOMS.find((zoom) => zoom >= wanted) ?? TILE_MAX_ZOOM
}

interface UseHeatmapTilesParams {
  /** From the heatmap payload; null when this heatmap has no pyramid. */
  tileSource: FitnessRouteHeatmapTileSource | null | undefined
  fetchTiles?: HeatmapTileFetcher
}

/** One tile's worth of drawable runs, with the key that identifies it. */
export interface HeatmapTileGroup {
  key: string
  runs: HeatmapTileRun[]
}

export interface UseHeatmapTilesResult {
  /** False when nothing can be fetched; the caller draws untiled geometry. */
  enabled: boolean
  /** Hand every settled viewport to this; it debounces and dedupes for you. */
  onViewChange: (viewport: HeatmapViewport) => void
  /**
   * The runs for the last viewport that RESOLVED. Deliberately not cleared when
   * a new viewport arrives: a pan would otherwise blank the map for as long as
   * the fetch takes, which reads as breakage rather than loading.
   */
  runs: HeatmapTileRun[]
  /**
   * The same runs, still grouped by the tile they came from.
   *
   * A GL source takes one flat collection and diffs nothing, so it uses `runs`.
   * MapKit has no data source and no overlay identity, so it has to add and
   * remove polylines itself — and rebuilding every one on every pan would drop
   * and recreate thousands of them for a few tiles' worth of change. Grouping
   * is what lets it diff, and it has to come from here: once the runs are
   * flattened, which tile a run came from is not recoverable.
   */
  groups: HeatmapTileGroup[]
  /** The zoom `runs` were drawn from, or null before the first batch. */
  zoom: number | null
}

/**
 * Total vertices the cache may hold.
 *
 * The real bound, and the one that matters: a decoded vertex is a `{lat, lng}`
 * OBJECT, measured at ~82 bytes each in V8 — so a tile COUNT is a poor proxy
 * for memory, because the tile format deliberately has no per-tile point
 * ceiling. 2048 dense city tiles are over 200 MB. This caps the cache near
 * 50 MB regardless of how dense the tiles turn out to be.
 */
const TILE_CACHE_MAX_VERTICES = 600_000

const runVertices = (runs: HeatmapTileRun[]) =>
  runs.reduce((total, run) => total + run.points.length, 0)

/**
 * Evicts oldest-first until both bounds hold, never touching a tile the CURRENT
 * view needs.
 *
 * The protection is what makes the two bounds safe together: a single dense
 * view can exceed the vertex budget on its own, and evicting from it would
 * assemble the map with holes it cannot detect. Those tiles are what is being
 * drawn, so they are kept and the budget is exceeded until the view moves on.
 */
const evict = (
  cache: Map<string, HeatmapTileRun[]>,
  protectedKeys: Set<string>
) => {
  let vertices = 0
  for (const runs of cache.values()) vertices += runVertices(runs)

  for (const key of [...cache.keys()]) {
    if (
      cache.size <= TILE_CACHE_MAX_TILES &&
      vertices <= TILE_CACHE_MAX_VERTICES
    ) {
      return
    }
    if (protectedKeys.has(key)) continue
    vertices -= runVertices(cache.get(key) ?? [])
    cache.delete(key)
  }
}

interface TileColumns {
  xs: number[]
  minY: number
  maxY: number
  count: number
}

/**
 * The tile columns and row range a view covers, SPLIT across the antimeridian.
 *
 * `tilesForBounds` signals a wrap by answering `minX > maxX` and says in its
 * own docblock that splitting it is the caller's job — its previous callers
 * were server reads whose `whereBetween` harmlessly matched nothing. Doing the
 * split here is what lets someone in Fiji or Chukotka see street detail at all;
 * without it every view containing 180 degrees fell back to the whole-history
 * geometry, permanently, while a neighbour 20 km west got tiles.
 */
const tileColumnsForBounds = (
  bounds: FitnessRouteHeatmapBounds,
  z: number
): TileColumns => {
  const range = tilesForBounds(bounds, z)
  const rows = range.maxY - range.minY + 1
  if (rows <= 0) return { xs: [], minY: range.minY, maxY: range.maxY, count: 0 }

  const columnCount = 2 ** z
  // How many columns the RAW span needs, alongside what the normalised pair
  // implies. The normalised pair is exact for an ordinary view, but it cannot
  // describe a span within one column-width of a whole world: both ends
  // normalise into the SAME column, which reads as a single column and would
  // fetch one sixteenth of a world view — geometry assembled with holes that
  // nothing downstream can detect, which is the failure this file exists to
  // avoid. Taking the larger of the two keeps ordinary views exact and rescues
  // that band.
  const spanColumns = Math.floor(
    (bounds.maxLng - bounds.minLng) / (360 / columnCount)
  )
  const normalisedColumns =
    range.minX <= range.maxX
      ? range.maxX - range.minX + 1
      : columnCount - range.minX + range.maxX + 1
  const needed = Math.min(
    columnCount,
    Math.max(normalisedColumns, spanColumns + 1)
  )

  // Stepping with modulo covers the antimeridian wrap and the near-world case
  // under one rule, and the cap keeps the list free of duplicates.
  const xs: number[] = []
  for (let index = 0; index < needed; index += 1) {
    xs.push((range.minX + index) % columnCount)
  }

  return { xs, minY: range.minY, maxY: range.maxY, count: xs.length * rows }
}

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

/**
 * Fetches, caches and decodes heatmap tiles for whatever the map is looking at.
 *
 * The shape is dictated by three facts. A viewport routinely needs MORE than
 * `MAX_TILES_PER_REQUEST` tiles — the ladder steps by 2, so a view just past a
 * rung rounds up nearly two levels and a desktop map wants ~160 of them, and
 * the whole world at the coarsest rung is 256 — so batching is the normal path,
 * not a safety net. Panning re-asks for mostly the same tiles, so the cache is
 * what makes it cheap rather than the request size. And a pyramid rebuild
 * invalidates everything at once, which is why the version is part of every key
 * and a batch answering with a different one empties the cache.
 */
export const useHeatmapTiles = ({
  tileSource,
  fetchTiles
}: UseHeatmapTilesParams): UseHeatmapTilesResult => {
  // A tile written at a different extent would decode against the wrong
  // coordinate space; `decodeTile` validates points against the compiled-in
  // TILE_EXTENT and would answer [] rather than complain, so the mismatch is
  // caught here instead and the surface stays on its untiled geometry.
  const enabled = Boolean(
    tileSource && fetchTiles && tileSource.extent === TILE_EXTENT
  )

  const cacheRef = useRef(new Map<string, HeatmapTileRun[]>())
  const versionRef = useRef<number>(tileSource?.version ?? 0)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchRef = useRef<HeatmapTileFetcher | undefined>(fetchTiles)
  // The last viewport the map reported, so the hook can re-ask for it when its
  // own inputs change rather than waiting for the next gesture.
  const viewportRef = useRef<HeatmapViewport | null>(null)
  const signatureRef = useRef<string | null>(null)
  const [state, setState] = useState<{
    runs: HeatmapTileRun[]
    groups: HeatmapTileGroup[]
    zoom: number | null
  }>({ runs: [], groups: [], zoom: null })

  useEffect(() => {
    fetchRef.current = fetchTiles
  }, [fetchTiles])

  // A different pyramid is a different set of tiles; nothing cached survives.
  //
  // And the map must be re-asked, not merely cleared. Every call into this hook
  // comes from a map GESTURE, so a pyramid that finishes building — or is
  // rebuilt — while someone is looking at the map would otherwise leave them on
  // untiled geometry until they happened to pan.
  const sourceVersion = tileSource?.version ?? 0
  useEffect(() => {
    abortRef.current?.abort()
    if (timerRef.current) clearTimeout(timerRef.current)
    versionRef.current = sourceVersion
    cacheRef.current.clear()
    signatureRef.current = null
    setState({ runs: [], groups: [], zoom: null })

    const viewport = viewportRef.current
    if (!enabled || !viewport) return
    void loadRef.current(viewport)
  }, [enabled, sourceVersion])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      abortRef.current?.abort()
    },
    []
  )

  const load = useCallback(async ({ zoom, bounds }: HeatmapViewport) => {
    const fetcher = fetchRef.current
    if (!fetcher) return

    // Give up on the whole view, and make sure the pass that WOULD have drawn
    // it stops too. Without the abort an in-flight batch lands after this and
    // repaints the view that was just abandoned, with tiles for somewhere the
    // map is no longer looking.
    const abandon = () => {
      abortRef.current?.abort()
      abortRef.current = null
      signatureRef.current = null
      setState({ runs: [], groups: [], zoom: null })
    }

    // A span of a whole world or more cannot be tiled: `projectWebMercator`
    // normalises each end independently, so 540 degrees of longitude collapses
    // to a sliver and would be drawn as if it were the entire map. Reject it on
    // the RAW span, before normalisation hides it.
    if (
      bounds.maxLng - bounds.minLng >= 360 ||
      bounds.maxLat <= bounds.minLat
    ) {
      abandon()
      return
    }

    // Coarsen until the view fits rather than abandoning it. Stepping DOWN the
    // ladder trades detail for coverage, which is the trade the ladder already
    // makes for a wider view; refusing would strand whatever was drawn before.
    const ladder = TILE_LADDER_ZOOMS as readonly number[]
    let z = storedZoomForView(zoom)
    let columns = tileColumnsForBounds(bounds, z)
    while (z > TILE_MIN_ZOOM && columns.count > MAX_TILES_PER_VIEW) {
      z = ladder[ladder.indexOf(z) - 1] ?? TILE_MIN_ZOOM
      columns = tileColumnsForBounds(bounds, z)
    }

    if (columns.count <= 0 || columns.count > MAX_TILES_PER_VIEW) {
      abandon()
      return
    }

    const wanted: Array<{ x: number; y: number }> = []
    for (const x of columns.xs) {
      for (let y = columns.minY; y <= columns.maxY; y += 1) {
        wanted.push({ x, y })
      }
    }

    const cache = cacheRef.current
    const keyFor = (x: number, y: number) =>
      `${versionRef.current}:${z}:${x}:${y}`
    // Touch what this view already holds BEFORE fetching, so the tiles it is
    // about to draw are the newest entries. Otherwise eviction — which runs as
    // each batch lands — takes the returning view's own cached tiles first,
    // exactly the ones it is assembling from.
    for (const { x, y } of wanted) {
      const key = keyFor(x, y)
      const cached = cache.get(key)
      if (!cached) continue
      cache.delete(key)
      cache.set(key, cached)
    }
    const protectedKeys = new Set(wanted.map(({ x, y }) => keyFor(x, y)))
    const missing = wanted.filter(({ x, y }) => !cache.has(keyFor(x, y)))

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      for (const batch of chunk(missing, MAX_TILES_PER_REQUEST)) {
        const response = await fetcher({
          z,
          tiles: batch,
          version: versionRef.current,
          signal: controller.signal
        })
        if (controller.signal.aborted) return

        // The pyramid was rebuilt underneath us. Restart the whole view rather
        // than carrying on: `missing` was computed against the OLD version, so
        // the batches already cached are now unreachable under the new key
        // prefix, and continuing would assemble a view out of whatever happened
        // to arrive after the switch — a map with holes it cannot detect.
        //
        // Only ever forward. A response answering an OLDER version is a reply
        // to a request this pass has already superseded; adopting it would
        // rewind the version and re-show the previous build's tiles.
        if (response.version > versionRef.current) {
          cache.clear()
          versionRef.current = response.version
          void loadRef.current({ zoom, bounds })
          return
        }
        // Anything else the server can answer — notably version 0, which is
        // how a route says "no completed pyramid" while one is rebuilding —
        // means this view cannot be drawn from tiles. Fall back rather than
        // leaving the previous view's tiles standing over new ground.
        if (response.version !== versionRef.current) {
          abandon()
          return
        }

        for (const { x, y } of batch) {
          const payload = response.tiles[`${x}:${y}`]
          const key = `${versionRef.current}:${z}:${x}:${y}`
          cache.set(
            key,
            payload ? tileRunsToLngLat(z, x, y, decodeTile(payload)) : []
          )
        }

        evict(cache, protectedKeys)
      }
    } catch {
      // A tile fetch is detail on top of geometry the surface already drew, so
      // a failure leaves the previous view standing rather than blanking the
      // map or surfacing an error the reader can do nothing about. An abort is
      // the common case here and is not a failure at all.
      return
    }

    if (controller.signal.aborted) return

    const runs: HeatmapTileRun[] = []
    const groups: HeatmapTileGroup[] = []
    for (const { x, y } of wanted) {
      const key = `${versionRef.current}:${z}:${x}:${y}`
      const cached = cache.get(key)
      if (!cached) continue
      // Touch on read so the LRU evicts what the viewport stopped needing
      // rather than what it happens to have held longest.
      cache.delete(key)
      cache.set(key, cached)
      if (cached.length === 0) continue
      runs.push(...cached)
      groups.push({ key, runs: cached })
    }

    // Bail when nothing changed. Every settled gesture lands here, and a new
    // array identity would rebuild the GeoJSON and push it to the map even for
    // a pan that moved within tiles already drawn.
    const signature = `${z}|${groups.map((group) => group.key).join(',')}`
    if (signature === signatureRef.current) return
    signatureRef.current = signature
    setState({ runs, groups, zoom: z })
  }, [])

  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])

  const onViewChange = useCallback(
    (viewport: HeatmapViewport) => {
      if (!enabled) return
      viewportRef.current = viewport
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        void load(viewport)
      }, VIEW_SETTLE_MS)
    },
    [enabled, load]
  )

  return useMemo(
    () => ({
      enabled,
      onViewChange,
      runs: state.runs,
      groups: state.groups,
      zoom: state.zoom
    }),
    [enabled, onViewChange, state]
  )
}
