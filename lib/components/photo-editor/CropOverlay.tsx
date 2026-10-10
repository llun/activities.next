'use client'

import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react'

import type { Size } from '@/lib/services/medias/edit/geometry'
import type { Aspect, CropRect } from '@/lib/services/medias/edit/recipe'

import {
  type HandleDirection,
  type Point,
  getAspectRatio,
  getHandlePoints,
  moveCrop,
  resizeCrop
} from './cropMath'

interface Props {
  crop: CropRect
  straighten: number
  aspect: Aspect
  aspectPortrait: boolean
  /** Size of the oriented image, in source pixels. */
  oriented: Size
  /** Size the image is drawn at, in CSS pixels. */
  css: Size
  disabled?: boolean
  onChange: (crop: CropRect) => void
  onGestureStart: () => void
  onGestureEnd: () => void
}

type Drag =
  | { kind: 'move'; start: CropRect; origin: Point }
  | {
      kind: 'handle'
      start: CropRect
      direction: Pick<HandleDirection, 'x' | 'y'>
    }

const HANDLE_TARGET = 24

/**
 * The crop frame over the oriented image: 8 handles with 24 px touch targets,
 * a draggable interior, a rule-of-thirds grid, and the outside dimmed. The
 * frame is drawn rotated by the straighten angle (the output is the crop
 * turned that way). The interior is focusable: arrows move the crop 1%, with
 * Shift 5%.
 */
export const CropOverlay = ({
  crop,
  straighten,
  aspect,
  aspectPortrait,
  oriented,
  css,
  disabled = false,
  onChange,
  onGestureStart,
  onGestureEnd
}: Props) => {
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [focused, setFocused] = useState(false)
  const scale = css.width / oriented.width

  const points = getHandlePoints(crop, straighten, oriented)
  // nw, ne, se, sw
  const corners = [points[0], points[2], points[4], points[6]].map((p) => ({
    x: p.x * scale,
    y: p.y * scale
  }))
  const polygon = corners.map((p) => `${p.x},${p.y}`).join(' ')
  const clip = `polygon(${corners.map((p) => `${p.x}px ${p.y}px`).join(', ')})`
  const lerp = (a: Point, b: Point, t: number): Point => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  })
  const [nw, ne, se, sw] = corners
  const thirds = [1 / 3, 2 / 3].flatMap((t) => [
    [lerp(nw, ne, t), lerp(sw, se, t)],
    [lerp(nw, sw, t), lerp(ne, se, t)]
  ])

  const pointer = (event: PointerEvent): Point => {
    const rect = root.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return { x: 0, y: 0 }
    return {
      x: ((event.clientX - rect.left) / rect.width) * oriented.width,
      y: ((event.clientY - rect.top) / rect.height) * oriented.height
    }
  }

  const begin = (event: PointerEvent<HTMLElement>, next: Drag) => {
    if (disabled) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = next
    onGestureStart()
  }
  const move = (event: PointerEvent) => {
    const active = drag.current
    if (!active) return
    const at = pointer(event)
    if (active.kind === 'move') {
      onChange(
        moveCrop(
          active.start,
          at.x - active.origin.x,
          at.y - active.origin.y,
          straighten,
          oriented
        )
      )
    } else {
      onChange(
        resizeCrop(
          active.start,
          active.direction,
          at,
          straighten,
          oriented,
          getAspectRatio(aspect, aspectPortrait, oriented)
        )
      )
    }
  }
  const end = () => {
    if (!drag.current) return
    drag.current = null
    onGestureEnd()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const step = event.shiftKey ? 0.05 : 0.01
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    }
    const direction = delta[event.key]
    if (!direction) return
    event.preventDefault()
    onChange(
      moveCrop(
        crop,
        direction[0] * oriented.width,
        direction[1] * oriented.height,
        straighten,
        oriented
      )
    )
  }

  return (
    <div
      ref={root}
      data-slot="crop-overlay"
      className="absolute inset-0 touch-none select-none"
    >
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${css.width} ${css.height}`}
        className="pointer-events-none absolute inset-0 size-full"
      >
        <path
          fillRule="evenodd"
          className="fill-black/50"
          d={`M0 0H${css.width}V${css.height}H0Z M${corners
            .map((p) => `${p.x} ${p.y}`)
            .join(' L')}Z`}
        />
        {thirds.map(([a, b], index) => (
          <line
            key={index}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className="stroke-white/60"
            strokeWidth="1"
          />
        ))}
        <polygon
          points={polygon}
          fill="none"
          className="stroke-white"
          strokeWidth={focused ? 3 : 1.5}
        />
      </svg>
      <div
        role="group"
        tabIndex={disabled ? -1 : 0}
        aria-label="Crop area"
        className="absolute inset-0 cursor-move outline-none"
        style={{ clipPath: clip }}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPointerDown={(event) =>
          begin(event, { kind: 'move', start: crop, origin: pointer(event) })
        }
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      {points.map(({ handle, x, y }) => (
        <span
          key={handle.id}
          data-handle={handle.id}
          aria-hidden="true"
          className="absolute flex cursor-pointer items-center justify-center"
          style={{
            width: HANDLE_TARGET,
            height: HANDLE_TARGET,
            left: x * scale - HANDLE_TARGET / 2,
            top: y * scale - HANDLE_TARGET / 2
          }}
          onPointerDown={(event) =>
            begin(event, {
              kind: 'handle',
              start: crop,
              direction: { x: handle.x, y: handle.y }
            })
          }
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <span className="size-2.5 rounded-sm border border-black/40 bg-white shadow-sm" />
        </span>
      ))}
    </div>
  )
}
