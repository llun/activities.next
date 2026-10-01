'use client'

import { GripHorizontal } from 'lucide-react'
import {
  type FC,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'

import { cn } from '@/lib/utils'

interface ResizableMapContainerProps {
  children: ReactNode
  storageKey: string
  defaultHeight?: number
  minHeight?: number
  maxHeight?: number
  className?: string
}

export const ResizableMapContainer: FC<ResizableMapContainerProps> = ({
  children,
  storageKey,
  defaultHeight = 400,
  minHeight = 200,
  maxHeight = 800,
  className
}) => {
  const [height, setHeight] = useState<number>(defaultHeight)
  const [isMounted, setIsMounted] = useState(false)
  const isDragging = useRef(false)
  const startY = useRef(0)
  const startHeight = useRef(0)

  useEffect(() => {
    setIsMounted(true)
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed = parseInt(stored, 10)
        if (!isNaN(parsed)) {
          setHeight(Math.min(Math.max(parsed, minHeight), maxHeight))
        }
      }
    } catch {
      // ignore
    }
  }, [storageKey, minHeight, maxHeight])

  const commitHeight = useCallback(
    (newHeight: number) => {
      setHeight(newHeight)
      try {
        localStorage.setItem(storageKey, newHeight.toString())
      } catch {
        // ignore
      }
    },
    [storageKey]
  )

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    // e.currentTarget is the handle
    e.currentTarget.setPointerCapture(e.pointerId)
    isDragging.current = true
    startY.current = e.clientY
    startHeight.current = height
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return
    const delta = e.clientY - startY.current
    const newHeight = Math.min(
      Math.max(startHeight.current + delta, minHeight),
      maxHeight
    )
    setHeight(newHeight)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    isDragging.current = false
    commitHeight(height)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = 24
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      commitHeight(Math.max(height - step, minHeight))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      commitHeight(Math.min(height + step, maxHeight))
    } else if (e.key === 'Home') {
      e.preventDefault()
      commitHeight(minHeight)
    } else if (e.key === 'End') {
      e.preventDefault()
      commitHeight(maxHeight)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commitHeight(defaultHeight)
    }
  }

  const handleDoubleClick = () => {
    commitHeight(defaultHeight)
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <div
        className="relative w-full shrink-0"
        style={{ height: isMounted ? height : defaultHeight }}
      >
        {children}
        {isDragging.current && (
          <div className="absolute inset-0 z-50 cursor-ns-resize" />
        )}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize map"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        onDoubleClick={handleDoubleClick}
        className="group flex h-4 w-full cursor-ns-resize touch-none select-none items-center justify-center bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted/80"
      >
        <div className="flex h-1.5 w-8 items-center justify-center rounded-full bg-border group-focus-visible:bg-foreground/20 group-hover:bg-foreground/20">
          <GripHorizontal className="size-3 text-muted-foreground/40 group-focus-visible:text-muted-foreground/60 group-hover:text-muted-foreground/60" />
        </div>
      </div>
    </div>
  )
}
