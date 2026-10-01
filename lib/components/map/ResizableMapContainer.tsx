'use client'

import { GripHorizontal, Maximize2, Minimize2 } from 'lucide-react'
import { type FC, type ReactNode, useCallback, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

export interface ResizableMapContainerProps {
  children: ReactNode
  defaultHeight?: number
  expandedHeight?: number
  minHeight?: number
  maxHeight?: number
  showQuickToggle?: boolean
  className?: string
}

export const ResizableMapContainer: FC<ResizableMapContainerProps> = ({
  children,
  defaultHeight = 288,
  expandedHeight = 560,
  minHeight = 200,
  maxHeight = 800,
  showQuickToggle = true,
  className
}) => {
  const [height, setHeight] = useState<number>(defaultHeight)
  const [isDragging, setIsDragging] = useState(false)
  const startY = useRef(0)
  const startHeight = useRef(0)

  const isExpanded = height >= expandedHeight - 40

  const toggleExpand = useCallback(() => {
    setHeight((current) =>
      current >= expandedHeight - 40 ? defaultHeight : expandedHeight
    )
  }, [defaultHeight, expandedHeight])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
    startY.current = e.clientY
    startHeight.current = height
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    const delta = e.clientY - startY.current
    const newHeight = Math.min(
      Math.max(startHeight.current + delta, minHeight),
      maxHeight
    )
    setHeight(newHeight)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    try {
      if (
        typeof e.currentTarget.hasPointerCapture === 'function' &&
        e.currentTarget.hasPointerCapture(e.pointerId)
      ) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } else {
        e.currentTarget.releasePointerCapture?.(e.pointerId)
      }
    } catch {
      // ignore DOMException if pointer capture was already lost
    }
    setIsDragging(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = 24
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHeight((h) => Math.max(h - step, minHeight))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHeight((h) => Math.min(h + step, maxHeight))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setHeight(minHeight)
    } else if (e.key === 'End') {
      e.preventDefault()
      setHeight(maxHeight)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      setHeight(defaultHeight)
    }
  }

  const handleDoubleClick = () => {
    setHeight(defaultHeight)
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="relative w-full shrink-0" style={{ height }}>
        {children}
        {showQuickToggle && (
          <button
            type="button"
            onClick={toggleExpand}
            className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-md border bg-background/95 text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={isExpanded ? 'Minimize map' : 'Expand map'}
            title={isExpanded ? 'Minimize map' : 'Expand map'}
          >
            {isExpanded ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </button>
        )}
        {isDragging && (
          <div className="absolute inset-0 z-50 cursor-ns-resize" />
        )}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize map height"
        aria-valuenow={height}
        aria-valuemin={minHeight}
        aria-valuemax={maxHeight}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        onDoubleClick={handleDoubleClick}
        className="group flex h-4 w-full cursor-ns-resize touch-none select-none items-center justify-center border-t border-border bg-muted/40 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title="Drag up or down to resize map (Double-click to reset)"
      >
        <div className="flex h-1.5 w-8 items-center justify-center rounded-full bg-border transition-colors group-hover:bg-foreground/20 group-focus-visible:bg-foreground/20">
          <GripHorizontal className="size-3 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground group-focus-visible:text-muted-foreground" />
        </div>
      </div>
    </div>
  )
}
