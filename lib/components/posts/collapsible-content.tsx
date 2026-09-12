'use client'

import { ChevronDown, ChevronRight } from 'lucide-react'
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
  onReadMore?: () => void
}

const LINE_HEIGHT_REM = 1.4375 // ~line height for text-sm leading-relaxed

export const CollapsibleContent: FC<CollapsibleContentProps> = ({
  children,
  className,
  contentClassName,
  maxLines = 5,
  onReadMore
}) => {
  const measuredContentRef = useRef<HTMLDivElement>(null)
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
    const el = measuredContentRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      checkOverflow()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [checkOverflow])

  const needsCollapse = isOverflowing && !isExpanded
  const shouldClamp = needsCollapse || (!hasCheckedOverflow && !isExpanded)

  return (
    <div className={cn('relative min-h-0', shouldClamp && 'overflow-hidden')}>
      <div
        id={contentId}
        className={cn(className, shouldClamp && 'overflow-hidden min-h-0')}
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
        <div className="absolute bottom-0 left-0 right-0 flex items-end justify-center bg-gradient-to-t from-background to-transparent pt-8 pb-0">
          {onReadMore ? (
            <Button
              type="button"
              variant="outline"
              aria-controls={contentId}
              aria-label="Read full post"
              className="bg-background/80 backdrop-blur-sm"
              onClick={(e) => {
                e.stopPropagation()
                onReadMore()
              }}
            >
              <span>Read full post</span>
              <ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
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
          )}
        </div>
      )}
    </div>
  )
}
