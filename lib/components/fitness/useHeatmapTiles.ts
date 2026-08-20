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
 * A hard ceiling on tiles per view, independent of the request batching.
 *
 * `tilesForBounds` answers a rectangle of indices, and a caller handing in a
 * wide bounds with a deep zoom — inconsistent inputs, but nothing stops them —
 * would otherwise enumerate billions of coordinates before anything noticed.
 * A view needing more than this is not a view worth tiling, so it draws the
 * untiled geometry instead.
 *
 * The real worst case is far below it: a full-bleed embed at the least
 * favourable ladder rounding wants about 300 tiles, so this is roughly a
 * viewport's worth of headroom rather than a limit anyone meets.
 */
export const MAX_TILES_PER_VIEW = 384

/**
 * How many decoded tiles to keep. Sized so panning back and forth across a
 * city, and stepping one zoom out and in again, are both free.
 *
 * **It must exceed `MAX_TILES_PER_VIEW`, and that is a correctness bound, not a
 * tuning one.** Tiles are inserted batch by batch while a view loads, and
 * eviction takes the oldest first — so a cache smaller than one view would
 * evict the batches that view had already fetched before it finished
 * assembling, and the map would draw itself with holes it has no way to notice.
 * Above that floor it is a memory trade: a tile is a few KB of decoded runs, so
 * this holds a couple of viewports in a few MB.
 */
export const TILE_CACHE_MAX_TILES = 1024

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
  const [state, setState] = useState<{
    runs: HeatmapTileRun[]
    groups: HeatmapTileGroup[]
    zoom: number | null
  }>({ runs: [], groups: [], zoom: null })

  useEffect(() => {
    fetchRef.current = fetchTiles
  }, [fetchTiles])

  // A different pyramid is a different set of tiles; nothing cached survives.
  const sourceVersion = tileSource?.version ?? 0
  useEffect(() => {
    versionRef.current = sourceVersion
    cacheRef.current.clear()
    setState({ runs: [], groups: [], zoom: null })
  }, [sourceVersion])

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

    const z = storedZoomForView(zoom)
    const range = tilesForBounds(bounds, z)
    const width = range.maxX - range.minX + 1
    const height = range.maxY - range.minY + 1
    if (width <= 0 || height <= 0) return
    if (width * height > MAX_TILES_PER_VIEW) return

    const wanted: Array<{ x: number; y: number }> = []
    for (let x = range.minX; x <= range.maxX; x += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        wanted.push({ x, y })
      }
    }

    const cache = cacheRef.current
    const keyFor = (x: number, y: number) =>
      `${versionRef.current}:${z}:${x}:${y}`
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

        // The pyramid was rebuilt underneath us. What prevents the two builds
        // being MIXED is the version in every cache key, not this line —
        // advancing the version alone would already make the old entries
        // unreachable. Clearing is about memory: unreachable entries would
        // otherwise sit in the cache counting toward its cap until eviction
        // pushed them out, crowding out live tiles for a while after a rebuild.
        if (response.version !== versionRef.current) {
          cache.clear()
          versionRef.current = response.version
        }

        for (const { x, y } of batch) {
          const payload = response.tiles[`${x}:${y}`]
          const key = `${versionRef.current}:${z}:${x}:${y}`
          cache.set(
            key,
            payload ? tileRunsToLngLat(z, x, y, decodeTile(payload)) : []
          )
        }

        while (cache.size > TILE_CACHE_MAX_TILES) {
          const oldest = cache.keys().next()
          if (oldest.done) break
          cache.delete(oldest.value)
        }
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

    setState({ runs, groups, zoom: z })
  }, [])

  const onViewChange = useCallback(
    (viewport: HeatmapViewport) => {
      if (!enabled) return
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
