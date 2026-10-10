'use client'

import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  type Size,
  getOrientedSize,
  getRecipeOutputSize
} from '@/lib/services/medias/edit/geometry'
import type { Geometry, Recipe } from '@/lib/services/medias/edit/recipe'

import { BLUR_MAX_EDGE } from './engine/colour'
import { drawGeometry } from './engine/geometryCanvas'
import { type Renderer, createRenderer } from './engine/glRenderer'
import {
  type Histogram,
  type ImageStats,
  computeHistogram,
  computeStats
} from './engine/histogram'
import { fitLongEdge, getPreviewSizes } from './engine/previewSize'
import { useElementSize } from './useElementSize'

export type EditorTab = 'adjust' | 'crop'
export type RendererStatus = 'idle' | 'ready' | 'lost' | 'error'

const HISTOGRAM_INTERVAL_MS = 150
const HISTOGRAM_EDGE = 512
const AUTO_EDGE = 512

interface Args {
  containerRef: RefObject<HTMLElement | null>
  canvasRef: RefObject<HTMLCanvasElement | null>
  bitmap: ImageBitmap | null
  recipe: Recipe
  tab: EditorTab
}

/**
 * Owns the preview renderer: creates it for the canvas, redraws the geometry
 * when the geometry or the stage size changes, and runs the colour pass on
 * `requestAnimationFrame` when the adjustments change (one render per frame,
 * the latest adjustments win). The Crop tab shows the whole oriented frame.
 */
export const useRenderer = ({
  containerRef,
  canvasRef,
  bitmap,
  recipe,
  tab
}: Args) => {
  const box = useElementSize(containerRef, bitmap !== null)
  const [status, setStatus] = useState<RendererStatus>('idle')
  const [generation, setGeneration] = useState(0)
  const [frameVersion, setFrameVersion] = useState(0)
  const [histogram, setHistogram] = useState<Histogram | null>(null)

  const rendererRef = useRef<Renderer | null>(null)
  const adjustmentsRef = useRef(recipe.adjustments)
  const recipeRef = useRef(recipe)
  const frameRequest = useRef(0)
  const histogramTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const histogramAt = useRef(0)

  useEffect(() => {
    adjustmentsRef.current = recipe.adjustments
    recipeRef.current = recipe
  })

  const source = useMemo<Size | null>(
    () => (bitmap ? { width: bitmap.width, height: bitmap.height } : null),
    [bitmap]
  )

  // What the stage shows: the recipe's geometry, or the whole oriented frame
  // while cropping (straighten and crop are drawn by the overlay).
  const geometryKey = JSON.stringify(
    tab === 'crop'
      ? {
          ...recipe.geometry,
          crop: { x: 0, y: 0, width: 1, height: 1 },
          straighten: 0
        }
      : recipe.geometry
  )
  const previewGeometry = useMemo(
    () => JSON.parse(geometryKey) as Geometry,
    [geometryKey]
  )

  const devicePixelRatio =
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const sizes = useMemo(() => {
    if (!source || box.width <= 0 || box.height <= 0) return null
    const output = getRecipeOutputSize(source, { geometry: previewGeometry })
    return getPreviewSizes(output, box, devicePixelRatio)
  }, [source, previewGeometry, box, devicePixelRatio])

  const orientedSize = useMemo<Size>(
    () =>
      source
        ? getOrientedSize(source, recipe.geometry.rotate90)
        : { width: 1, height: 1 },
    [source, recipe.geometry.rotate90]
  )

  const publishHistogram = useCallback(() => {
    histogramTimer.current = null
    histogramAt.current = Date.now()
    const renderer = rendererRef.current
    const pixels = renderer?.readPreview(HISTOGRAM_EDGE)
    if (pixels) {
      setHistogram(computeHistogram(pixels.data, pixels.width, pixels.height))
    }
  }, [])

  const schedule = useCallback(() => {
    if (frameRequest.current) return
    frameRequest.current = requestAnimationFrame(() => {
      frameRequest.current = 0
      const renderer = rendererRef.current
      if (!renderer || renderer.isContextLost()) return
      renderer.renderPreview(adjustmentsRef.current)
      if (histogramTimer.current) return
      const wait = Math.max(
        0,
        HISTOGRAM_INTERVAL_MS - (Date.now() - histogramAt.current)
      )
      histogramTimer.current = setTimeout(publishHistogram, wait)
    })
  }, [publishHistogram])

  // The renderer lives as long as the canvas does.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !bitmap) return
    let renderer: Renderer | null = null
    try {
      renderer = createRenderer(canvas, {
        onContextLost: () => setStatus('lost')
      })
    } catch {
      renderer = null
    }
    if (!renderer) {
      setStatus('error')
      return
    }
    rendererRef.current = renderer
    setStatus('ready')
    return () => {
      renderer.dispose()
      if (rendererRef.current === renderer) rendererRef.current = null
      if (frameRequest.current) cancelAnimationFrame(frameRequest.current)
      frameRequest.current = 0
      if (histogramTimer.current) clearTimeout(histogramTimer.current)
      histogramTimer.current = null
    }
  }, [bitmap, canvasRef, generation])

  // Geometry (and stage size) changes redraw the frame the shader reads.
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || status !== 'ready' || !bitmap || !sizes) return
    const { pixels } = sizes
    try {
      const image = drawGeometry(
        bitmap,
        previewGeometry,
        pixels.width,
        pixels.height
      )
      const blurSize = fitLongEdge(pixels, BLUR_MAX_EDGE)
      const blur =
        blurSize.width === pixels.width && blurSize.height === pixels.height
          ? image
          : drawGeometry(
              bitmap,
              previewGeometry,
              blurSize.width,
              blurSize.height
            )
      renderer.setPreviewFrame({ image, size: pixels, blur, blurSize })
      setFrameVersion((version) => version + 1)
    } catch {
      setStatus('error')
    }
  }, [bitmap, previewGeometry, sizes, status])

  // New adjustments, or a new frame, schedule one colour pass.
  useEffect(() => {
    if (status === 'ready') schedule()
  }, [recipe.adjustments, frameVersion, status, schedule])

  const getAutoStats = useCallback((): ImageStats | null => {
    if (!bitmap) return null
    const geometry = recipeRef.current.geometry
    const output = getRecipeOutputSize(
      { width: bitmap.width, height: bitmap.height },
      { geometry }
    )
    const size = fitLongEdge(output, AUTO_EDGE)
    const canvas = drawGeometry(bitmap, geometry, size.width, size.height)
    const context = canvas.getContext('2d') as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!context) return null
    const image = context.getImageData(0, 0, size.width, size.height)
    return computeStats(image.data, size.width, size.height)
  }, [bitmap])

  const retry = useCallback(() => {
    setStatus('idle')
    setGeneration((value) => value + 1)
  }, [])

  return {
    status,
    /** Change it to give the stage a fresh canvas (a lost context is final). */
    canvasKey: generation,
    box,
    /** The canvas's CSS size; null until the stage has been measured. */
    css: sizes?.css ?? null,
    orientedSize,
    histogram,
    getAutoStats,
    retry
  }
}
