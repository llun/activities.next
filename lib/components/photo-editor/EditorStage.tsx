'use client'

import { type RefObject, useEffect, useRef } from 'react'

import { Alert } from '@/lib/components/surface/Alert'
import type { Size } from '@/lib/services/medias/edit/geometry'
import type { CropRect, Geometry } from '@/lib/services/medias/edit/recipe'

import { CropOverlay } from './CropOverlay'
import { getPreviewSizes } from './engine/previewSize'
import type { EditorTab, RendererStatus } from './useRenderer'

interface Props {
  containerRef: RefObject<HTMLDivElement | null>
  canvasRef: RefObject<HTMLCanvasElement | null>
  canvasKey: number
  bitmap: ImageBitmap | null
  /** Stage content size, for fitting the compare view. */
  box: Size
  /** The preview canvas's CSS size; null before the stage is measured. */
  css: Size | null
  status: RendererStatus
  tab: EditorTab
  comparing: boolean
  geometry: Geometry
  orientedSize: Size
  disabled: boolean
  /** Spoken by the polite live region (compare, Auto). */
  announcement: string
  onCropChange: (crop: CropRect) => void
  onGestureStart: (key: string) => void
  onGestureEnd: () => void
  onRetry: () => void
}

/**
 * The picture. The preview canvas shows the recipe (or the whole oriented
 * frame with the crop overlay on the Crop tab); while comparing, a second
 * canvas shows the source fitted and uncropped with nothing applied.
 */
export const EditorStage = ({
  containerRef,
  canvasRef,
  canvasKey,
  bitmap,
  box,
  css,
  status,
  tab,
  comparing,
  geometry,
  orientedSize,
  disabled,
  announcement,
  onCropChange,
  onGestureStart,
  onGestureEnd,
  onRetry
}: Props) => {
  const compareRef = useRef<HTMLCanvasElement>(null)
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const compareSizes =
    bitmap && box.width > 0 && box.height > 0
      ? getPreviewSizes(
          { width: bitmap.width, height: bitmap.height },
          box,
          dpr
        )
      : null

  const compareWidth = compareSizes?.pixels.width ?? 0
  const compareHeight = compareSizes?.pixels.height ?? 0
  useEffect(() => {
    const canvas = compareRef.current
    if (!comparing || !bitmap || !canvas || compareWidth === 0) return
    const context = canvas.getContext('2d')
    if (!context) return
    canvas.width = compareWidth
    canvas.height = compareHeight
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, compareWidth, compareHeight)
  }, [comparing, bitmap, compareWidth, compareHeight])

  const failed = status === 'lost' || status === 'error'

  return (
    <div className="relative min-h-0 flex-1 bg-photo-stage p-3 md:p-6">
      <div
        ref={containerRef}
        className="relative flex size-full items-center justify-center"
      >
        <div
          className="relative"
          style={css ? { width: css.width, height: css.height } : undefined}
          hidden={comparing}
        >
          <canvas
            key={canvasKey}
            ref={canvasRef}
            role="img"
            aria-label="Photo preview"
            className="block size-full"
          />
          {tab === 'crop' && css && !comparing && !failed ? (
            <CropOverlay
              crop={geometry.crop}
              straighten={geometry.straighten}
              aspect={geometry.aspect}
              aspectPortrait={Boolean(geometry.aspectPortrait)}
              oriented={orientedSize}
              css={css}
              disabled={disabled}
              onChange={onCropChange}
              onGestureStart={() => onGestureStart('crop')}
              onGestureEnd={onGestureEnd}
            />
          ) : null}
        </div>
        <canvas
          ref={compareRef}
          hidden={!comparing}
          aria-hidden="true"
          className="absolute inset-0 m-auto"
          style={
            compareSizes
              ? {
                  width: compareSizes.css.width,
                  height: compareSizes.css.height
                }
              : undefined
          }
        />
        {failed ? (
          <div className="absolute inset-x-0 top-0 z-10">
            <Alert
              title="Couldn't render the photo. Try again."
              onRetry={onRetry}
            />
          </div>
        ) : null}
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  )
}
