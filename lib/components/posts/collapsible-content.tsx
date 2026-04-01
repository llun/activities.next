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

import { cn } from '@/lib/utils'

interface CollapsibleContentProps {
  children: ReactNode
  className?: string
}

const MAX_HEIGHT_REM = 5.75 // ~4 lines of text-sm leading-relaxed

export const CollapsibleContent: FC<CollapsibleContentProps> = ({
  children,
  className
}) => {
  const contentRef = useRef<HTMLDivElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const contentId = useId()

  const checkOverflow = useCallback(() => {
    const el = contentRef.current
    if (!el) return

    const maxHeightPx =
      MAX_HEIGHT_REM *
      parseFloat(getComputedStyle(document.documentElement).fontSize)
    setIsOverflowing(el.scrollHeight > maxHeightPx + 2) // 2px tolerance
  }, [])

  useEffect(() => {
    checkOverflow()
  }, [children, checkOverflow])

  useEffect(() => {
    const el = contentRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      checkOverflow()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [checkOverflow])

  const needsCollapse = isOverflowing && !isExpanded

  return (
    <div className="relative">
      <div
        id={contentId}
        ref={contentRef}
        className={cn(className, needsCollapse && 'overflow-hidden')}
        style={
          needsCollapse ? { maxHeight: `${MAX_HEIGHT_REM}rem` } : undefined
        }
      >
        {children}
      </div>
      {needsCollapse && (
        <div
          className="absolute bottom-0 left-0 right-0 flex items-end justify-center bg-gradient-to-t from-background to-transparent pt-8 pb-0 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            setIsExpanded(true)
          }}
        >
          <button
            type="button"
            aria-expanded={false}
            aria-controls={contentId}
            aria-label="Show more content"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors bg-background/80 backdrop-blur-sm px-2 py-0.5 rounded-full border border-border/60"
          >
            <span>Show more</span>
            <ChevronDown className="size-3" />
          </button>
        </div>
      )}
    </div>
  )
}
