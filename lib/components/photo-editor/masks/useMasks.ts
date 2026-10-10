'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Size } from '@/lib/services/medias/edit/geometry'
import {
  type Geometry,
  MAX_MASKS,
  type Mask,
  type MaskAdjustments,
  type MaskPoint,
  type Recipe
} from '@/lib/services/medias/edit/recipe'

import {
  DEFAULT_BRUSH_SIZE,
  MAX_BRUSH_SIZE,
  MIN_BRUSH_SIZE,
  paintStroke
} from './brushRaster'
import { type Focus, focusToSourcePoint } from './focusPoint'
import { MASK_COPY } from './maskCopy'
import {
  type MaskRaster,
  cloneRaster,
  createRaster,
  getMaskSize,
  getRasters,
  withRaster
} from './maskRaster'
import {
  addBackgroundMask,
  addBrushMask,
  addSubjectMask,
  canAddMask,
  canAddPoint,
  getMask,
  getMaskName,
  getSubjectWithoutBackground,
  newMaskId,
  removeMask,
  resetMaskAdjustments,
  setMaskAdjustment,
  setMaskFeather,
  setSubjectPoints
} from './maskRecipe'
import {
  ModelIntegrityError,
  type SubjectModel,
  getModelBytes,
  isModelCached,
  loadSubjectModel
} from './modelCache'
import { type SamClient, type SamMask, createSamClient } from './samClient'
import { getSamResize } from './samPre'

export type RefineMode = 'add' | 'remove' | 'brush'

export type SamState =
  | { phase: 'idle' }
  | { phase: 'downloading'; loadedBytes: number; totalBytes: number }
  | { phase: 'preparing' }
  | { phase: 'working' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }

interface Args {
  /** The present recipe; it carries the mask pixels (see maskRaster.ts). */
  recipe: Recipe
  /** Records a new present recipe in the history. */
  onChange: (recipe: Recipe, coalesceKey?: string) => void
  source: Size
  bitmap: ImageBitmap | null
  focus: Focus | null
  /** The geometry the stored render was made with, for the focus point. */
  storedGeometry: Geometry | null
  /** Null hides Select subject. */
  model: SubjectModel | null
  /** True while saving. */
  disabled: boolean
  announce: (text: string) => void
  /** Test seam: the worker client. */
  createClient?: () => SamClient
}

export interface LiveRaster {
  id: string
  raster: MaskRaster
}

const errorText = (error: unknown) =>
  error instanceof ModelIntegrityError
    ? MASK_COPY.modelChecksum
    : MASK_COPY.modelFailed

/**
 * The Masks tab's state and actions: which mask is selected, the refine mode
 * and brush, the model download and the worker, and every edit as a recipe
 * change (so undo and redo cover it).
 */
export const useMasks = ({
  recipe,
  onChange,
  source,
  bitmap,
  focus,
  storedGeometry,
  model,
  disabled,
  announce,
  createClient = createSamClient
}: Args) => {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refineMode, setRefineMode] = useState<RefineMode>('add')
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE)
  const [brushErase, setBrushErase] = useState(false)
  const [overlayVisible, setOverlayVisible] = useState(true)
  const [sam, setSam] = useState<SamState>({ phase: 'idle' })
  const [live, setLive] = useState<LiveRaster | null>(null)

  const recipeRef = useRef(recipe)
  const clientRef = useRef<SamClient | null>(null)
  const embeddedFor = useRef<ImageBitmap | null>(null)
  const readyPromise = useRef<Promise<SamClient> | null>(null)
  // One per mount: closing the editor aborts the download and tells every
  // step of `ensureReady` to stop and free what it made.
  const lifecycle = useRef<{
    disposed: boolean
    controller: AbortController
  } | null>(null)
  const workingRef = useRef(false)
  const stroke = useRef<{
    id: string
    raster: MaskRaster
    radius: number
    last: { x: number; y: number }
    frame: number
  } | null>(null)

  useEffect(() => {
    recipeRef.current = recipe
  })

  const masks = recipe.masks
  const selected =
    getMask(recipe, selectedId) ?? masks[masks.length - 1] ?? undefined
  const effectiveId = selected?.id ?? null

  // Taps need the model, so without it (turned off on this server) even a
  // stored subject is refined with the brush.
  const clampMode = (mask: Mask | undefined, mode: RefineMode): RefineMode => {
    if (!mask) return mode
    if (mask.kind === 'brush') return 'brush'
    if (mask.kind === 'subject' && !model) return 'brush'
    return mode
  }
  const mode = clampMode(selected, refineMode)

  // A new photo means new embeddings; the model itself stays loaded.
  useEffect(() => {
    embeddedFor.current = null
  }, [bitmap])

  useEffect(() => {
    const own = { disposed: false, controller: new AbortController() }
    lifecycle.current = own
    return () => {
      own.disposed = true
      own.controller.abort()
      clientRef.current?.dispose()
      clientRef.current = null
      readyPromise.current = null
      if (stroke.current) cancelAnimationFrame(stroke.current.frame)
    }
  }, [])

  const ensureReady = useCallback(async (): Promise<SamClient> => {
    if (!model || !bitmap) throw new Error('No subject model')
    if (readyPromise.current && embeddedFor.current === bitmap) {
      return readyPromise.current
    }
    const life = lifecycle.current
    if (!life) throw new Error('No subject model')
    const closed = () => new DOMException('The editor was closed', 'AbortError')
    const run = async () => {
      let client = clientRef.current
      if (!client) {
        // A cached model is read, not downloaded, so it never shows the
        // download copy.
        const cached = await isModelCached(model).catch(() => false)
        if (life.disposed) throw closed()
        setSam(
          cached
            ? { phase: 'preparing' }
            : {
                phase: 'downloading',
                loadedBytes: 0,
                totalBytes: getModelBytes(model)
              }
        )
        const files = await loadSubjectModel(model, {
          signal: life.controller.signal,
          onProgress: ({ loadedBytes, totalBytes, cached }) => {
            if (life.disposed || cached) return
            setSam({ phase: 'downloading', loadedBytes, totalBytes })
          }
        })
        if (life.disposed) throw closed()
        setSam({ phase: 'preparing' })
        const created = createClient()
        // Held before `load` so closing the editor can end its worker.
        clientRef.current = created
        try {
          await created.load(files.encoder, files.decoder)
        } catch (error) {
          created.dispose()
          if (clientRef.current === created) clientRef.current = null
          throw error
        }
        if (life.disposed) {
          created.dispose()
          if (clientRef.current === created) clientRef.current = null
          throw closed()
        }
        client = created
      }
      if (embeddedFor.current !== bitmap) {
        setSam({ phase: 'preparing' })
        const resized = getSamResize({
          width: bitmap.width,
          height: bitmap.height
        })
        const small = await createImageBitmap(bitmap, {
          resizeWidth: resized.width,
          resizeHeight: resized.height,
          resizeQuality: 'high'
        })
        if (life.disposed) {
          small.close?.()
          throw closed()
        }
        await client.embed(small)
        if (life.disposed) throw closed()
        embeddedFor.current = bitmap
      }
      return client
    }
    const promise = run()
    readyPromise.current = promise
    try {
      return await promise
    } catch (error) {
      if (readyPromise.current === promise) readyPromise.current = null
      throw error
    }
  }, [bitmap, createClient, model])

  /** Runs the model for a set of points; null when it failed (state says so). */
  const segment = useCallback(
    async (points: MaskPoint[]): Promise<SamMask | null> => {
      if (workingRef.current) return null
      workingRef.current = true
      try {
        const client = await ensureReady()
        setSam({ phase: 'working' })
        const mask = await client.segment(points)
        if (lifecycle.current?.disposed) return null
        setSam({ phase: 'ready' })
        return mask
      } catch (error) {
        // Closing the editor is not a failure to report.
        if (lifecycle.current?.disposed) return null
        setSam({
          phase: 'error',
          message:
            clientRef.current && !(error instanceof ModelIntegrityError)
              ? MASK_COPY.segmentFailed
              : errorText(error)
        })
        return null
      } finally {
        workingRef.current = false
      }
    },
    [ensureReady]
  )

  const toRaster = (mask: SamMask): MaskRaster => ({
    width: mask.width,
    height: mask.height,
    data: new Uint8ClampedArray(mask.data)
  })

  // ---- Adding and removing masks -----------------------------------------

  const atLimit = !canAddMask(recipe)
  const canSelectSubject = model !== null
  const subjectForBackground = getSubjectWithoutBackground(recipe, effectiveId)
  const canAddBackgroundMask = !atLimit && Boolean(subjectForBackground)
  const working =
    sam.phase === 'working' ||
    sam.phase === 'downloading' ||
    sam.phase === 'preparing'

  const selectSubject = useCallback(async () => {
    if (disabled || !model || !canAddMask(recipeRef.current)) return
    const point = focusToSourcePoint(focus, source, storedGeometry)
    const result = await segment([point])
    if (!result) return
    const latest = recipeRef.current
    if (!canAddMask(latest)) return
    const id = newMaskId(latest.masks.map((mask) => mask.id))
    onChange(
      withRaster(addSubjectMask(latest, id, point), id, toRaster(result))
    )
    setSelectedId(id)
    setRefineMode('add')
    announce('Subject selected')
  }, [
    announce,
    disabled,
    focus,
    model,
    onChange,
    segment,
    source,
    storedGeometry
  ])

  const addBackground = useCallback(() => {
    const latest = recipeRef.current
    const subject = getSubjectWithoutBackground(latest, selectedId)
    if (disabled || !subject || !canAddMask(latest)) return
    const id = newMaskId(latest.masks.map((mask) => mask.id))
    onChange(addBackgroundMask(latest, id, subject.id))
    setSelectedId(id)
    announce('Background added')
  }, [announce, disabled, onChange, selectedId])

  const addBrush = useCallback(() => {
    const latest = recipeRef.current
    if (disabled || !canAddMask(latest)) return
    const id = newMaskId(latest.masks.map((mask) => mask.id))
    onChange(
      withRaster(
        addBrushMask(latest, id),
        id,
        createRaster(getMaskSize(source))
      )
    )
    setSelectedId(id)
    setRefineMode('brush')
    announce('Brush mask added')
  }, [announce, disabled, onChange, source])

  const remove = useCallback(
    (id: string) => {
      if (disabled) return
      const latest = recipeRef.current
      const name = getMaskName(latest, id)
      onChange(removeMask(latest, id))
      setSelectedId((current) => (current === id ? null : current))
      announce(`${name} mask removed`)
    },
    [announce, disabled, onChange]
  )

  // ---- Per-mask sliders ---------------------------------------------------

  const adjust = useCallback(
    (key: keyof MaskAdjustments, value: number) => {
      if (!effectiveId) return
      onChange(
        setMaskAdjustment(recipeRef.current, effectiveId, key, value),
        `${effectiveId}:${key}`
      )
    },
    [effectiveId, onChange]
  )

  const resetAdjustments = useCallback(
    (keys: ReadonlyArray<keyof MaskAdjustments>) => {
      if (!effectiveId) return
      onChange(resetMaskAdjustments(recipeRef.current, effectiveId, keys))
    },
    [effectiveId, onChange]
  )

  const setFeather = useCallback(
    (value: number) => {
      if (!effectiveId) return
      onChange(
        setMaskFeather(recipeRef.current, effectiveId, value),
        `${effectiveId}:feather`
      )
    },
    [effectiveId, onChange]
  )

  // ---- Refining ------------------------------------------------------------

  /** A tap on the photo (0..1 in the original) in Add or Remove mode. */
  const tap = useCallback(
    async (point: { x: number; y: number }) => {
      const latest = recipeRef.current
      const mask = getMask(latest, effectiveId)
      if (disabled || !mask || mask.kind !== 'subject') return
      if (!model) {
        announce(MASK_COPY.subjectOffAnnounce)
        return
      }
      if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return
      if (!canAddPoint(mask)) {
        announce('This mask has the most points it can hold')
        return
      }
      const label: 0 | 1 = mode === 'remove' ? 0 : 1
      const points = [...mask.points, { x: point.x, y: point.y, label }]
      const result = await segment(points)
      if (!result) return
      const next = recipeRef.current
      if (!getMask(next, mask.id)) return
      onChange(
        withRaster(
          setSubjectPoints(next, mask.id, points),
          mask.id,
          toRaster(result)
        )
      )
      announce(
        label === 1 ? 'Added to the subject' : 'Removed from the subject'
      )
    },
    [announce, disabled, effectiveId, mode, model, onChange, segment]
  )

  const eraseRef = useRef(brushErase)
  useEffect(() => {
    eraseRef.current = brushErase
  })

  const paintTo = useCallback((point: { x: number; y: number }) => {
    const active = stroke.current
    if (!active) return
    const { raster } = active
    const to = { x: point.x * raster.width, y: point.y * raster.height }
    paintStroke(
      raster,
      active.last,
      to,
      active.radius,
      eraseRef.current ? 'erase' : 'add'
    )
    active.last = to
    if (!active.frame) {
      active.frame = requestAnimationFrame(() => {
        active.frame = 0
        // A new wrapper per frame: the renderer caches by object identity.
        setLive({
          id: active.id,
          raster: {
            width: raster.width,
            height: raster.height,
            data: raster.data
          }
        })
      })
    }
  }, [])

  /** Begins a brush stroke; `radius` is in source pixels. */
  const strokeStart = useCallback(
    (point: { x: number; y: number }, radius: number) => {
      const latest = recipeRef.current
      const mask = getMask(latest, effectiveId)
      if (disabled || !mask || mask.kind === 'background') return
      const base = getRasters(latest)[mask.id]
      if (!base) return
      const raster = cloneRaster(base)
      const perSource = raster.width / source.width
      stroke.current = {
        id: mask.id,
        raster,
        radius: Math.max(0.5, radius * perSource),
        last: { x: point.x * raster.width, y: point.y * raster.height },
        frame: 0
      }
      paintTo(point)
    },
    [disabled, effectiveId, paintTo, source.width]
  )

  const strokeMove = paintTo

  const strokeEnd = useCallback(() => {
    const active = stroke.current
    stroke.current = null
    if (!active) return
    if (active.frame) cancelAnimationFrame(active.frame)
    setLive(null)
    const latest = recipeRef.current
    if (!getMask(latest, active.id)) return
    onChange(withRaster(latest, active.id, cloneRaster(active.raster)))
  }, [onChange])

  const selectMask = useCallback((id: string) => setSelectedId(id), [])

  const raster = effectiveId ? getRasters(recipe)[effectiveId] : undefined

  return useMemo(
    () => ({
      masks,
      selected,
      selectedId: effectiveId,
      select: selectMask,
      mode,
      setMode: setRefineMode,
      brushSize,
      setBrushSize: (size: number) =>
        setBrushSize(Math.min(MAX_BRUSH_SIZE, Math.max(MIN_BRUSH_SIZE, size))),
      brushErase,
      setBrushErase,
      overlayVisible,
      setOverlayVisible,
      sam,
      working,
      atLimit,
      maxMasks: MAX_MASKS,
      canSelectSubject,
      canAddBackground: canAddBackgroundMask,
      canRefine: Boolean(selected && selected.kind !== 'background'),
      hasRaster: Boolean(raster),
      live,
      selectSubject,
      addBackground,
      addBrush,
      remove,
      adjust,
      resetAdjustments,
      setFeather,
      tap,
      strokeStart,
      strokeMove,
      strokeEnd
    }),
    [
      masks,
      selected,
      effectiveId,
      selectMask,
      mode,
      brushSize,
      brushErase,
      overlayVisible,
      sam,
      working,
      atLimit,
      canSelectSubject,
      canAddBackgroundMask,
      raster,
      live,
      selectSubject,
      addBackground,
      addBrush,
      remove,
      adjust,
      resetAdjustments,
      setFeather,
      tap,
      strokeStart,
      strokeMove,
      strokeEnd
    ]
  )
}

export type MaskTools = ReturnType<typeof useMasks>
