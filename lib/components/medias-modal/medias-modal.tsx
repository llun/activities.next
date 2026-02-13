import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Media } from '@/lib/components/posts/media'
import { Button } from '@/lib/components/ui/button'
import { Attachment } from '@/lib/types/domain/attachment'
import { cn } from '@/lib/utils'

const MIN_SWIPE_DISTANCE = 50 // Minimum distance in pixels for a swipe to be recognized
const INTERACTIVE_SWIPE_IGNORE_SELECTOR =
  'button, a, input, textarea, select, label, [role="button"], video, audio'

interface Props {
  medias: Attachment[] | null
  initialSelection: number
  onClosed: () => void
}

export const MediasModal: FC<Props> = ({
  medias,
  initialSelection,
  onClosed
}) => {
  const [currentIndex, setCurrentIndex] = useState<number>(0)
  const [dragOffsetX, setDragOffsetX] = useState(0)
  const [isSwipeAnimating, setIsSwipeAnimating] = useState(false)
  const [pendingSwipeDirection, setPendingSwipeDirection] = useState<
    -1 | 0 | 1
  >(0)
  const [mounted, setMounted] = useState(false)
  const touchStartX = useRef<number | null>(null)
  const touchEndX = useRef<number | null>(null)
  const isSwipeGesture = useRef(false)
  const swipeTrackRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  useEffect(() => {
    setCurrentIndex(initialSelection)
    setDragOffsetX(0)
    setIsSwipeAnimating(false)
    setPendingSwipeDirection(0)
  }, [initialSelection])

  const handleClose = useCallback(() => {
    setCurrentIndex(0)
    setDragOffsetX(0)
    setIsSwipeAnimating(false)
    setPendingSwipeDirection(0)
    onClosed()
  }, [onClosed])

  const getWrappedIndex = useCallback(
    (index: number) => {
      if (!medias || medias.length === 0) return 0
      return (index + medias.length) % medias.length
    },
    [medias]
  )

  const handlePrevious = useCallback(() => {
    setCurrentIndex((prev) => getWrappedIndex(prev - 1))
  }, [getWrappedIndex])

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => getWrappedIndex(prev + 1))
  }, [getWrappedIndex])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!medias) return
      if (e.key === 'Escape') handleClose()
      if (e.key === 'ArrowLeft') handlePrevious()
      if (e.key === 'ArrowRight') handleNext()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [medias, handleClose, handlePrevious, handleNext])

  useEffect(() => {
    if (medias) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [medias])

  const resetSwipeTracking = useCallback(() => {
    touchStartX.current = null
    touchEndX.current = null
    isSwipeGesture.current = false
  }, [])

  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!medias || medias.length <= 1 || e.touches.length !== 1) {
        return
      }

      const target = e.target as HTMLElement | null
      if (target?.closest(INTERACTIVE_SWIPE_IGNORE_SELECTOR)) {
        resetSwipeTracking()
        return
      }

      isSwipeGesture.current = true
      setIsSwipeAnimating(false)
      setPendingSwipeDirection(0)

      touchStartX.current = e.touches[0].clientX
      touchEndX.current = null
    },
    [medias, resetSwipeTracking]
  )

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!isSwipeGesture.current || touchStartX.current === null) {
      return
    }

    touchEndX.current = e.touches[0].clientX
    setDragOffsetX(touchEndX.current - touchStartX.current)
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (!medias || medias.length <= 1 || !isSwipeGesture.current) {
      resetSwipeTracking()
      return
    }

    const startX = touchStartX.current
    const endX = touchEndX.current

    if (startX === null || endX === null) {
      setIsSwipeAnimating(false)
      setDragOffsetX(0)
      resetSwipeTracking()
      return
    }

    const swipeDistance = endX - startX
    const isValidSwipe = Math.abs(swipeDistance) > MIN_SWIPE_DISTANCE

    setIsSwipeAnimating(true)

    if (isValidSwipe) {
      const direction: -1 | 1 = swipeDistance < 0 ? 1 : -1
      const trackWidth = swipeTrackRef.current?.clientWidth ?? window.innerWidth

      setPendingSwipeDirection(direction)
      setDragOffsetX(direction === 1 ? -trackWidth : trackWidth)
    } else {
      setPendingSwipeDirection(0)
      setDragOffsetX(0)
    }

    resetSwipeTracking()
  }, [medias, resetSwipeTracking])

  const handleTouchCancel = useCallback(() => {
    setIsSwipeAnimating(false)
    setPendingSwipeDirection(0)
    setDragOffsetX(0)
    resetSwipeTracking()
  }, [resetSwipeTracking])

  const handleTrackTransitionEnd = useCallback(() => {
    if (!isSwipeAnimating) {
      return
    }

    if (pendingSwipeDirection !== 0) {
      setCurrentIndex((prev) => getWrappedIndex(prev + pendingSwipeDirection))
      setPendingSwipeDirection(0)
      setIsSwipeAnimating(false)
      setDragOffsetX(0)
      return
    }

    setIsSwipeAnimating(false)
  }, [getWrappedIndex, isSwipeAnimating, pendingSwipeDirection])

  if (!mounted || !medias) return null

  const previousIndex = getWrappedIndex(currentIndex - 1)
  const nextIndex = getWrappedIndex(currentIndex + 1)
  const shouldShowNavigation = medias.length > 1
  const visibleIndices = [previousIndex, currentIndex, nextIndex]
  const hasDuplicateVisibleIndices =
    new Set(visibleIndices).size !== visibleIndices.length

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <span className="text-sm text-white">
          {shouldShowNavigation && `${currentIndex + 1} / ${medias.length}`}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClose}
          className="text-white hover:bg-white/20"
        >
          <X className="h-6 w-6" />
        </Button>
      </div>

      {/* Main content */}
      <div className="relative flex flex-1 items-center justify-center px-4 md:px-16">
        {shouldShowNavigation && (
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation()
                handlePrevious()
              }}
              className="absolute left-2 z-10 h-12 w-12 text-white hover:bg-white/20 md:left-4"
            >
              <ChevronLeft className="h-8 w-8" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation()
                handleNext()
              }}
              className="absolute right-2 z-10 h-12 w-12 text-white hover:bg-white/20 md:right-4"
            >
              <ChevronRight className="h-8 w-8" />
            </Button>
          </>
        )}

        <div
          className="relative flex h-full w-full max-w-[90vw] items-center justify-center"
          onClick={handleClose}
        >
          <div
            ref={swipeTrackRef}
            className="relative flex h-full w-full items-center justify-center overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchCancel}
          >
            <div
              className="flex h-full w-[300%]"
              style={{
                transform: `translateX(calc(-100% + ${dragOffsetX}px))`,
                transition: isSwipeAnimating
                  ? 'transform 220ms ease-out'
                  : 'none'
              }}
              onTransitionEnd={handleTrackTransitionEnd}
            >
              {visibleIndices.map((index, panelIndex) => (
                <div
                  key={
                    hasDuplicateVisibleIndices
                      ? `${medias[index].id}-${panelIndex}`
                      : medias[index].id
                  }
                  className="flex h-full w-full shrink-0 items-center justify-center"
                >
                  <Media
                    showVideoControl
                    className="max-h-[80vh] max-w-full object-contain"
                    attachment={medias[index]}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Thumbnails */}
      {shouldShowNavigation && (
        <div className="flex justify-center gap-2 overflow-x-auto px-4 pb-4 pt-2">
          {medias.map((media, index) => (
            <button
              key={media.id}
              onClick={(e) => {
                e.stopPropagation()
                setCurrentIndex(index)
              }}
              className={cn(
                'relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded border-2 transition-colors md:h-20 md:w-20',
                index === currentIndex
                  ? 'border-primary'
                  : 'border-transparent opacity-60 hover:opacity-100'
              )}
            >
              <Media
                className="h-full w-full object-cover"
                attachment={media}
                showVideoControl={false} // Thumbnails shouldn't control video
              />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  )
}
