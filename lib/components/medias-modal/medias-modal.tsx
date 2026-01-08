import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { FC, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { Media } from '@/lib/components/posts/media'
import { Button } from '@/lib/components/ui/button'
import { Attachment } from '@/lib/models/attachment'
import { cn } from '@/lib/utils'

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
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  useEffect(() => {
    setCurrentIndex(initialSelection)
  }, [initialSelection])

  const handleClose = useCallback(() => {
    setCurrentIndex(0)
    onClosed()
  }, [onClosed])

  const handlePrevious = useCallback(() => {
    if (!medias) return
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : medias.length - 1))
  }, [medias])

  const handleNext = useCallback(() => {
    if (!medias) return
    setCurrentIndex((prev) => (prev < medias.length - 1 ? prev + 1 : 0))
  }, [medias])

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

  if (!mounted || !medias) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <span className="text-sm text-white">
          {medias.length > 1 && `${currentIndex + 1} / ${medias.length}`}
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
        {medias.length > 1 && (
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation()
                handlePrevious()
              }}
              className="absolute left-2 h-12 w-12 text-white hover:bg-white/20 md:left-4"
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
              className="absolute right-2 h-12 w-12 text-white hover:bg-white/20 md:right-4"
            >
              <ChevronRight className="h-8 w-8" />
            </Button>
          </>
        )}

        <div
          className="relative flex h-full w-full max-w-[90vw] items-center justify-center"
          onClick={handleClose} // Click outside/on container closes? Robin didn't specify but standard lightbox behavior.
        >
          <div
            className="flex h-full w-full items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <Media
              showVideoControl
              className="max-h-[80vh] max-w-full object-contain"
              attachment={medias[currentIndex]}
            />
          </div>
        </div>
      </div>

      {/* Thumbnails */}
      {medias.length > 1 && (
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
