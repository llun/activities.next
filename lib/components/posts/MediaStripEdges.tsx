'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { FC, useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

// The arrow is a 44px hit area around a 40px visual disc, so the target meets
// the touch-size minimum while the disc stays the size it always was.
const STRIP_ARROW_CLASS =
  'group absolute left-1.5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const STRIP_ARROW_FACE_CLASS =
  'flex size-10 items-center justify-center rounded-full bg-background/95 shadow-md transition-colors group-hover:bg-background'
// An arrow with nowhere to go stays mounted for focus but is invisible and
// takes no pointer input; aria-disabled tells assistive tech it is unavailable.
const STRIP_ARROW_EDGE_CLASS = 'pointer-events-none opacity-0'

// A smaller face for a short strip (the activity page's lap band), whose
// buttons are ~40px tall: the 40px media arrow would cover a whole lap.
const SMALL_ARROW_CLASS = 'size-9'
const SMALL_ARROW_FACE_CLASS = 'size-8'

interface Props {
  canScrollLeft: boolean
  canScrollRight: boolean
  /** `useMediaStripScroll().scrollByPage`. */
  onScrollByPage: (direction: 1 | -1) => void
  /** What the arrows scroll through, for their labels ("media", "laps"). */
  itemsLabel?: string
  size?: 'default' | 'small'
  /**
   * The fades' colour: the strip's own background, so the fade reads as the
   * content running out under it. `from-background/70` by default.
   */
  fadeClassName?: string
}

/**
 * The overflow affordances every horizontal media strip carries: an edge fade
 * on each side that has more content, and the Previous/Next arrows.
 *
 * Render it inside a `relative` wrapper that holds the scroller, only while the
 * strip overflows. The arrows stay mounted at an edge (`aria-disabled`, out of
 * the tab order) so a focused arrow never unmounts under the keyboard.
 */
export const MediaStripEdges: FC<Props> = ({
  canScrollLeft,
  canScrollRight,
  onScrollByPage,
  itemsLabel = 'media',
  size = 'default',
  fadeClassName = 'from-background/70'
}) => {
  const isSmall = size === 'small'
  const arrowClass = cn(STRIP_ARROW_CLASS, isSmall && SMALL_ARROW_CLASS)
  const faceClass = cn(
    STRIP_ARROW_FACE_CLASS,
    isSmall && SMALL_ARROW_FACE_CLASS
  )
  const iconClass = isSmall ? 'size-4' : 'size-5'
  // If the arrow that holds focus reaches its edge, focus moves to the opposite
  // arrow, which is the one with somewhere to go.
  const previousArrow = useRef<HTMLButtonElement | null>(null)
  const nextArrow = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    const focused = document.activeElement
    if (focused === previousArrow.current && !canScrollLeft && canScrollRight) {
      nextArrow.current?.focus()
    } else if (
      focused === nextArrow.current &&
      !canScrollRight &&
      canScrollLeft
    ) {
      previousArrow.current?.focus()
    }
  }, [canScrollLeft, canScrollRight])

  return (
    <>
      {canScrollLeft ? (
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 bg-linear-to-r to-transparent',
            isSmall ? 'w-12' : 'w-16',
            fadeClassName
          )}
        />
      ) : null}
      {canScrollRight ? (
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 bg-linear-to-l to-transparent',
            isSmall ? 'w-12' : 'w-16',
            fadeClassName
          )}
        />
      ) : null}
      <button
        ref={previousArrow}
        type="button"
        aria-label={`Previous ${itemsLabel}`}
        aria-disabled={!canScrollLeft}
        tabIndex={canScrollLeft ? undefined : -1}
        onClick={(event) => {
          event.stopPropagation()
          if (canScrollLeft) onScrollByPage(-1)
        }}
        className={cn(arrowClass, !canScrollLeft && STRIP_ARROW_EDGE_CLASS)}
      >
        <span aria-hidden="true" className={faceClass}>
          <ChevronLeft className={iconClass} />
        </span>
      </button>
      <button
        ref={nextArrow}
        type="button"
        aria-label={`Next ${itemsLabel}`}
        aria-disabled={!canScrollRight}
        tabIndex={canScrollRight ? undefined : -1}
        onClick={(event) => {
          event.stopPropagation()
          if (canScrollRight) onScrollByPage(1)
        }}
        className={cn(
          arrowClass,
          'right-1.5 left-auto',
          !canScrollRight && STRIP_ARROW_EDGE_CLASS
        )}
      >
        <span aria-hidden="true" className={faceClass}>
          <ChevronRight className={iconClass} />
        </span>
      </button>
    </>
  )
}
