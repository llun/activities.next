'use client'

import { ZoomIn } from 'lucide-react'
import {
  type ReactElement,
  type ReactNode,
  type RefObject,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'

import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import type { Size } from '@/lib/services/medias/edit/geometry'
import type { CropRect, Geometry } from '@/lib/services/medias/edit/recipe'

import { CropOverlay } from './CropOverlay'
import { getPreviewSizes } from './engine/previewSize'
import type { MaskTools } from './masks/useMasks'
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
  /** Drawn over the preview (the Masks tab's touch layer). */
  maskLayer?: ReactNode
  masks?: MaskTools
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
  maskLayer,
  masks,
  onCropChange,
  onGestureStart,
  onGestureEnd,
  onRetry
}: Props) => {
  const compareRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, startPanX: 0, startPanY: 0 })
  const spacePressed = useRef(false)

  // Reset zoom and pan automatically when switching to crop or when source bitmap changes
  useEffect(() => {
    if (tab === 'crop') {
      setZoom(1)
      setPan({ x: 0, y: 0 })
    }
  }, [tab])

  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [bitmap])

  const clampPan = useCallback(
    (nextPan: { x: number; y: number }, currentZoom: number) => {
      if (currentZoom <= 1 || !css) return { x: 0, y: 0 }
      const maxX = Math.max(0, (css.width * (currentZoom - 1)) / 2)
      const maxY = Math.max(0, (css.height * (currentZoom - 1)) / 2)
      return {
        x: Math.min(maxX, Math.max(-maxX, nextPan.x)),
        y: Math.min(maxY, Math.max(-maxY, nextPan.y))
      }
    },
    [css]
  )

  const [spaceHeld, setSpaceHeld] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handleWheel = (event: WheelEvent) => {
      if (tab === 'crop') return
      if (event.ctrlKey || event.metaKey || !event.shiftKey) {
        event.preventDefault()
        const delta = -event.deltaY * 0.005
        setZoom((prevZoom) => {
          const nextZoom = Math.min(4, Math.max(1, prevZoom + delta))
          if (nextZoom <= 1) {
            setPan({ x: 0, y: 0 })
            return 1
          }
          setPan((prevPan) => clampPan(prevPan, nextZoom))
          return Number(nextZoom.toFixed(2))
        })
      }
    }
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      container.removeEventListener('wheel', handleWheel)
    }
  }, [clampPan, containerRef, tab])

  const onDoubleClick = () => {
    if (tab === 'crop' || tab === 'masks') return
    setZoom((prevZoom) => {
      if (prevZoom > 1) {
        setPan({ x: 0, y: 0 })
        return 1
      }
      return 2
    })
  }

  useEffect(() => {
    if (zoom <= 1) {
      spacePressed.current = false
      setSpaceHeld(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || zoom <= 1) return
      const target = e.target as HTMLElement | null
      if (
        target?.closest(
          'button, input, textarea, select, [role="slider"], [role="radio"], [role="tab"], [role="menuitem"]'
        )
      ) {
        return
      }
      spacePressed.current = true
      setSpaceHeld(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spacePressed.current = false
        setSpaceHeld(false)
      }
    }
    const onBlur = () => {
      spacePressed.current = false
      setSpaceHeld(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [zoom])

  const onPointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1 || tab === 'crop') return
    if ((event.target as HTMLElement | null)?.closest('button')) return
    const shouldPan =
      event.button === 1 ||
      spacePressed.current ||
      spaceHeld ||
      (event.button === 0 && tab !== 'masks')

    if (shouldPan) {
      event.stopPropagation()
      event.preventDefault()
      isDragging.current = true
      dragStart.current = {
        x: event.clientX,
        y: event.clientY,
        startPanX: pan.x,
        startPanY: pan.y
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current || zoom <= 1) return
    const dx = event.clientX - dragStart.current.x
    const dy = event.clientY - dragStart.current.y
    const nextPan = {
      x: dragStart.current.startPanX + dx,
      y: dragStart.current.startPanY + dy
    }
    setPan(clampPan(nextPan, zoom))
  }

  const onPointerUp = () => {
    isDragging.current = false
  }

  // The CSS size does not depend on the pixel ratio; only the backing-store
  // size does, and that is read inside the effect (not during render) so a
  // window moving between a 1x and a 2x display is not frozen by the compiler.
  const compareSizes =
    bitmap && box.width > 0 && box.height > 0
      ? getPreviewSizes({ width: bitmap.width, height: bitmap.height }, box, 1)
      : null

  useEffect(() => {
    const canvas = compareRef.current
    if (!comparing || !bitmap || !canvas || box.width <= 0 || box.height <= 0)
      return
    const context = canvas.getContext('2d')
    if (!context) return
    const dpr = window.devicePixelRatio || 1
    const { pixels } = getPreviewSizes(
      { width: bitmap.width, height: bitmap.height },
      box,
      dpr
    )
    canvas.width = pixels.width
    canvas.height = pixels.height
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, pixels.width, pixels.height)
  }, [comparing, bitmap, box])

  const failed = status === 'lost' || status === 'error'

  const resolvedMaskLayer = (() => {
    if (!maskLayer || !isValidElement(maskLayer)) return maskLayer
    return cloneElement(
      maskLayer as ReactElement<{
        zoom?: number
        pan?: { x: number; y: number }
        onBoxSelect?: (box: {
          x0: number
          y0: number
          x1: number
          y1: number
        }) => void
      }>,
      {
        zoom,
        pan,
        ...(masks?.boxSelect ? { onBoxSelect: masks.boxSelect } : {})
      }
    )
  })()

  return (
    <div className="relative min-h-0 flex-1 bg-photo-stage p-3 md:p-6">
      <div
        ref={containerRef}
        className="relative flex size-full items-center justify-center overflow-hidden"
        onDoubleClick={onDoubleClick}
        onPointerDownCapture={onPointerDownCapture}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="relative transition-transform duration-75"
          style={{
            ...(css ? { width: css.width, height: css.height } : {}),
            transform:
              zoom > 1
                ? `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
                : undefined,
            transformOrigin: 'center center'
          }}
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
          {tab === 'masks' && !failed ? resolvedMaskLayer : null}
        </div>
        <canvas
          ref={compareRef}
          hidden={!comparing}
          aria-hidden="true"
          className="absolute inset-0 m-auto"
          style={{
            ...(compareSizes
              ? {
                  width: compareSizes.css.width,
                  height: compareSizes.css.height
                }
              : {}),
            transform:
              zoom > 1
                ? `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
                : undefined,
            transformOrigin: 'center center'
          }}
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
      {tab !== 'crop' && (
        <div className="absolute bottom-3 left-3 z-20 flex items-center gap-1.5">
          <Button
            type="button"
            variant="pill"
            size="sm"
            className="h-7 border-0 bg-black/60 px-2.5 text-xs text-white backdrop-blur hover:bg-black/70 max-md:min-h-10"
            onClick={() => {
              if (zoom > 1) {
                setZoom(1)
                setPan({ x: 0, y: 0 })
              } else {
                setZoom(2)
              }
            }}
            aria-label={zoom > 1 ? 'Reset zoom' : 'Zoom 2x'}
          >
            <ZoomIn className="size-3" aria-hidden="true" />
            {zoom > 1 ? `${Math.round(zoom * 10) / 10}× (Reset)` : '1×'}
          </Button>
        </div>
      )}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  )
}
