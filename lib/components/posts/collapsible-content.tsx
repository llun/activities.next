'use client'

import { ChevronDown } from 'lucide-react'
import {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from 'react'

import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

interface CollapsibleContentProps {
  children: ReactNode
  className?: string
  contentClassName?: string
  maxLines?: number
}

const LINE_HEIGHT_REM = 1.4375 // ~line height for text-sm leading-relaxed

// The collapsed text fades out over the height of the overlay that carries the
// pill (its `pt-8` plus the 36px `h-9` button = 4.25rem). The fade is a mask on
// the clipped text, not a gradient of some background colour laid over it: this
// block is rendered on the feed card (`bg-card`), on the page background in a
// thread, and inside other frames, and any one colour painted over the text
// shows as a band on all the others. A mask fades to whatever is behind it.
const COLLAPSED_FADE_CLASS =
  '[mask-image:linear-gradient(to_bottom,#000_calc(100%_-_4.25rem),transparent)]'

export const CollapsibleContent: FC<CollapsibleContentProps> = ({
  children,
  className,
  contentClassName,
  maxLines = 5
}) => {
  const measuredContentRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [hasCheckedOverflow, setHasCheckedOverflow] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const contentId = useId()

  const maxHeightRem = maxLines * LINE_HEIGHT_REM

  const checkOverflow = useCallback(() => {
    const el = measuredContentRef.current
    if (!el) return

    const maxHeightPx =
      maxHeightRem *
      parseFloat(getComputedStyle(document.documentElement).fontSize)
    setIsOverflowing(el.scrollHeight > maxHeightPx + 2) // 2px tolerance
    setHasCheckedOverflow(true)
  }, [maxHeightRem])

  useEffect(() => {
    checkOverflow()
  }, [children, checkOverflow])

  useEffect(() => {
    if (isExpanded) return

    const el = measuredContentRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      checkOverflow()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [checkOverflow, isExpanded])

  // Expanding unmounts the "Show more" button that had focus; without this the
  // focus would drop to <body> and a keyboard user would lose their place.
  useEffect(() => {
    if (isExpanded) {
      contentRef.current?.focus()
    }
  }, [isExpanded])

  const needsCollapse = isOverflowing && !isExpanded
  const shouldClamp = needsCollapse || (!hasCheckedOverflow && !isExpanded)

  return (
    <div className={cn('relative min-h-0', shouldClamp && 'overflow-hidden')}>
      <div
        id={contentId}
        ref={contentRef}
        tabIndex={-1}
        className={cn(
          'min-h-0',
          className,
          shouldClamp && 'overflow-hidden',
          needsCollapse && COLLAPSED_FADE_CLASS
        )}
        style={
          needsCollapse
            ? { height: `${maxHeightRem}rem` }
            : shouldClamp
              ? { maxHeight: `${maxHeightRem}rem` }
              : undefined
        }
      >
        <div ref={measuredContentRef} className={contentClassName}>
          {children}
        </div>
      </div>
      {needsCollapse && (
        <div className="absolute bottom-0 left-0 right-0 flex items-end justify-center pt-8 pb-0">
          <Button
            type="button"
            variant="pill"
            aria-expanded={isExpanded}
            aria-controls={contentId}
            aria-label="Show more content"
            className="bg-background/80 backdrop-blur-sm"
            onClick={(e) => {
              e.stopPropagation()
              setIsExpanded(true)
            }}
          >
            <span>Show more</span>
            <ChevronDown className="size-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
