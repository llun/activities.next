'use client'

import { Eye, EyeOff, Loader2 } from 'lucide-react'
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useMemo,
  useRef,
  useState
} from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  type Size,
  getGeometryTransform
} from '@/lib/services/medias/edit/geometry'
import type { Geometry, MaskPoint } from '@/lib/services/medias/edit/recipe'

import { MASK_COPY } from './maskCopy'
import { matrixScale, outputToSource, sourceToOutput } from './maskGeometry'
import type { RefineMode } from './useMasks'

interface Props {
  /** The preview canvas's CSS size. */
  css: Size
  source: Size
  geometry: Geometry
  /** The selected subject's points, drawn as markers. */
  points: ReadonlyArray<MaskPoint>
  mode: RefineMode
  /** False when the selected mask cannot be refined by hand. */
  canRefine: boolean
  disabled: boolean
  /** Text on the chip over the photo; null for none. */
  hint: string | null
  busy: boolean
  brushSize: number
  overlayVisible: boolean
  onOverlayVisibleChange: (visible: boolean) => void
  onTap: (point: { x: number; y: number }) => void
  /** `radius` is in source pixels. */
  onStrokeStart: (point: { x: number; y: number }, radius: number) => void
  onStrokeMove: (point: { x: number; y: number }) => void
  onStrokeEnd: () => void
}

const TAP_SLOP = 6
const KEY_STEP = 8
const KEY_STEP_LARGE = 40

/**
 * Sits over the preview on the Masks tab: a tap adds or removes a point, a
 * drag paints with the brush, and the subject's points are drawn as green +
 * and red - markers. The arrow keys move a crosshair and Enter acts there
 * (with the brush, Alt held with the arrows paints a line), so the refine
 * tools work without a pointer.
 */
export const MaskStageLayer = ({
  css,
  source,
  geometry,
  points,
  mode,
  canRefine,
  disabled,
  hint,
  busy,
  brushSize,
  overlayVisible,
  onOverlayVisibleChange,
  onTap,
  onStrokeStart,
  onStrokeMove,
  onStrokeEnd
}: Props) => {
  const layer = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const press = useRef<{
    x: number
    y: number
    moved: boolean
    stroking: boolean
  } | null>(null)
  // True while Alt is held with the arrow keys in brush mode: one stroke.
  const keyStroke = useRef(false)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)

  const matrix = useMemo(
    () => getGeometryTransform(source, geometry, css),
    [source, geometry, css]
  )
  const cssPerSource = matrixScale(matrix)
  const active = canRefine && !disabled && !busy

  const toSource = useCallback(
    (x: number, y: number) => outputToSource(matrix, { x, y }, source),
    [matrix, source]
  )

  const local = (event: PointerEvent) => {
    const rect = layer.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return { x: 0, y: 0 }
    return {
      x: ((event.clientX - rect.left) * css.width) / rect.width,
      y: ((event.clientY - rect.top) * css.height) / rect.height
    }
  }

  const moveRing = (x: number, y: number, visible: boolean) => {
    const element = ring.current
    if (!element) return
    element.style.transform = `translate(${x - brushSize / 2}px, ${y - brushSize / 2}px)`
    element.style.opacity = visible ? '1' : '0'
  }

  const radius = brushSize / 2 / (cssPerSource || 1)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!active || event.button > 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const at = local(event)
    const stroking = mode === 'brush'
    press.current = { ...at, moved: false, stroking }
    if (stroking) onStrokeStart(toSource(at.x, at.y), radius)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const at = local(event)
    if (mode === 'brush' && canRefine) moveRing(at.x, at.y, true)
    const current = press.current
    if (!current) return
    if (Math.hypot(at.x - current.x, at.y - current.y) > TAP_SLOP) {
      current.moved = true
    }
    if (current.stroking) onStrokeMove(toSource(at.x, at.y))
  }

  const finish = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const current = press.current
    press.current = null
    if (!current) return
    if (current.stroking) {
      onStrokeEnd()
      return
    }
    if (!cancelled && !current.moved) {
      const at = local(event)
      onTap(toSource(at.x, at.y))
    }
  }

  const endKeyStroke = () => {
    if (!keyStroke.current) return
    keyStroke.current = false
    onStrokeEnd()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keys pressed on a control inside the layer (the Overlay button) belong
    // to that control, not to the photo.
    if (event.target !== event.currentTarget) return
    if (!active) return
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    const base = cursor ?? { x: css.width / 2, y: css.height / 2 }
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      const next = {
        x: Math.min(css.width, Math.max(0, base.x + move[0])),
        y: Math.min(css.height, Math.max(0, base.y + move[1]))
      }
      setCursor(next)
      moveRing(next.x, next.y, mode === 'brush')
      if (event.altKey && mode === 'brush') {
        if (!keyStroke.current) {
          keyStroke.current = true
          onStrokeStart(toSource(base.x, base.y), radius)
        }
        onStrokeMove(toSource(next.x, next.y))
      } else {
        endKeyStroke()
      }
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const at = toSource(base.x, base.y)
      if (mode === 'brush') {
        endKeyStroke()
        onStrokeStart(at, radius)
        onStrokeEnd()
      } else {
        onTap(at)
      }
    }
  }

  const label =
    mode === 'brush'
      ? 'Mask area. Arrow keys move the pointer, Enter paints a dab, Alt with the arrow keys paints a line.'
      : mode === 'remove'
        ? 'Mask area. Arrow keys move the pointer, Enter removes that spot from the subject.'
        : 'Mask area. Arrow keys move the pointer, Enter adds that spot to the subject.'

  return (
    <div
      ref={layer}
      data-testid="mask-stage-layer"
      role="group"
      aria-label={label}
      aria-disabled={!active}
      tabIndex={canRefine ? 0 : -1}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (event.key === 'Alt') endKeyStroke()
      }}
      onBlur={() => {
        setCursor(null)
        endKeyStroke()
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, false)}
      onPointerCancel={(event) => finish(event, true)}
      onPointerLeave={() => moveRing(0, 0, false)}
      className="absolute inset-0 touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ cursor: active ? 'crosshair' : undefined }}
    >
      {points.map((point, index) => {
        const at = sourceToOutput(matrix, point, source)
        if (at.x < 0 || at.y < 0 || at.x > css.width || at.y > css.height) {
          return null
        }
        const positive = point.label === 1
        return (
          <span
            key={index}
            data-testid={positive ? 'point-add' : 'point-remove'}
            aria-hidden="true"
            className={
              positive
                ? 'pointer-events-none absolute grid size-[18px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-success text-xs leading-none font-bold text-success-foreground shadow'
                : 'pointer-events-none absolute grid size-[18px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-destructive text-xs leading-none font-bold text-destructive-foreground shadow'
            }
            style={{ left: at.x, top: at.y }}
          >
            {positive ? '+' : '−'}
          </span>
        )
      })}

      {cursor && mode !== 'brush' ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/60"
          style={{ left: cursor.x, top: cursor.y }}
        />
      ) : null}

      <div
        ref={ring}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 rounded-full border border-white opacity-0 ring-1 ring-black/60"
        style={{ width: brushSize, height: brushSize }}
      />

      {hint || busy ? (
        <span
          data-testid="mask-hint"
          className="pointer-events-none absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur"
        >
          {busy ? (
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          ) : null}
          {hint}
        </span>
      ) : null}

      <Button
        type="button"
        variant="pill"
        size="sm"
        aria-pressed={overlayVisible}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onOverlayVisibleChange(!overlayVisible)}
        className="absolute top-2 right-2 h-7 border-0 bg-black/60 px-2.5 text-xs text-white backdrop-blur hover:bg-black/70 max-md:min-h-10"
      >
        {overlayVisible ? (
          <Eye className="size-3" aria-hidden="true" />
        ) : (
          <EyeOff className="size-3" aria-hidden="true" />
        )}
        {MASK_COPY.overlay}
      </Button>
    </div>
  )
}
