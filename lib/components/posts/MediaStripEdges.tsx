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

interface Props {
  canScrollLeft: boolean
  canScrollRight: boolean
  /** `useMediaStripScroll().scrollByPage`. */
  onScrollByPage: (direction: 1 | -1) => void
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
  onScrollByPage
}) => {
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
          className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-linear-to-r from-background/70 to-transparent"
        />
      ) : null}
      {canScrollRight ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-linear-to-l from-background/70 to-transparent"
        />
      ) : null}
      <button
        ref={previousArrow}
        type="button"
        aria-label="Previous media"
        aria-disabled={!canScrollLeft}
        tabIndex={canScrollLeft ? undefined : -1}
        onClick={(event) => {
          event.stopPropagation()
          if (canScrollLeft) onScrollByPage(-1)
        }}
        className={cn(
          STRIP_ARROW_CLASS,
          !canScrollLeft && STRIP_ARROW_EDGE_CLASS
        )}
      >
        <span aria-hidden="true" className={STRIP_ARROW_FACE_CLASS}>
          <ChevronLeft className="size-5" />
        </span>
      </button>
      <button
        ref={nextArrow}
        type="button"
        aria-label="Next media"
        aria-disabled={!canScrollRight}
        tabIndex={canScrollRight ? undefined : -1}
        onClick={(event) => {
          event.stopPropagation()
          if (canScrollRight) onScrollByPage(1)
        }}
        className={cn(
          STRIP_ARROW_CLASS,
          'right-1.5 left-auto',
          !canScrollRight && STRIP_ARROW_EDGE_CLASS
        )}
      >
        <span aria-hidden="true" className={STRIP_ARROW_FACE_CLASS}>
          <ChevronRight className="size-5" />
        </span>
      </button>
    </>
  )
}
