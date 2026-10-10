import { ChevronLeft, ChevronRight, Info, Pause, Play, X } from 'lucide-react'
import {
  FC,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'

import { getMediaPublicDetails } from '@/lib/client'
import { CustomEmojiText } from '@/lib/components/actors/ActorDisplayName'
import {
  ALBUMS_MENU_SELECTOR,
  MediaAlbumsControl
} from '@/lib/components/gallery/MediaAlbumsControl'
import {
  MediaDetailsPanel,
  hasPublicDetailsContent
} from '@/lib/components/medias-modal/media-details-panel'
import { Media } from '@/lib/components/posts/media'
import { Button } from '@/lib/components/ui/button'
import type { MediaPublicDetails } from '@/lib/services/gallery/galleryEntities'
import { ActorEmojiTag } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Tag } from '@/lib/types/domain/tag'
import { cn } from '@/lib/utils'

const MIN_SWIPE_DISTANCE = 50 // Minimum distance in pixels for a swipe to be recognized
const INTERACTIVE_SWIPE_IGNORE_SELECTOR =
  'button, a, input, textarea, select, label, [role="button"], video, audio, .select-text'

interface Props {
  medias: Attachment[] | null
  tags?:
    | (
        | Pick<Tag, 'type' | 'name' | 'value'>
        | ActorEmojiTag
        | { type: string; name: string; value: string }
      )[]
    | null
  initialSelection: number
  /** The media's owner, shown in the details panel's "confirmed by" line. */
  ownerName?: string | null
  /**
   * The signed-in viewer's actor id when every photo shown is theirs. With it
   * the photo gets an "In N albums" pill that opens the add-to-album menu;
   * without it there is none and nothing is requested.
   */
  albumsOwnerId?: string | null
  /** Called with an album's id after the albums pill changed what it holds. */
  onAlbumsChange?: (albumId: string) => void
  onClosed: () => void
}

export const MediasModal: FC<Props> = ({
  medias,
  tags,
  initialSelection,
  ownerName,
  albumsOwnerId,
  onAlbumsChange,
  onClosed
}) => {
  const [modalGifPlaying, setModalGifPlaying] = useState<boolean | null>(null)
  const [activeGifPlaying, setActiveGifPlaying] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(initialSelection)
  const [dragOffsetX, setDragOffsetX] = useState(0)
  const [isSwipeAnimating, setIsSwipeAnimating] = useState(false)
  const [pendingSwipeDirection, setPendingSwipeDirection] = useState<
    -1 | 0 | 1
  >(0)
  const [mounted, setMounted] = useState(false)
  // The info overlay (alt text, public details, albums) is hidden whenever the
  // viewer opens and stays at the owner's choice while moving between photos.
  const [detailsOpen, setDetailsOpen] = useState(false)
  const detailsOverlayId = useId()
  const touchStartX = useRef<number | null>(null)
  const touchEndX = useRef<number | null>(null)
  const isSwipeGesture = useRef(false)
  // The press that closed the albums menu is the start of a click that would
  // reach the backdrop and close the viewer too; it only meant to close the
  // menu.
  const swallowBackdropClick = useRef(false)
  const swipeTrackRef = useRef<HTMLDivElement>(null)
  const detailsButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  // True while focus sits inside the overlay, so it can be put back when the
  // element holding it is removed (the albums pill remounts per photo).
  const focusInOverlay = useRef(false)
  // Public details, keyed by media id, so going back to a photo reuses the
  // answer. The cache belongs to one viewing session: it is dropped whenever
  // the attachment list changes (which includes closing the modal, since the
  // parent passes null), so a later open never shows details fetched before
  // the owner changed them. Requested ids are remembered so a photo is fetched
  // at most once per session (a failed request is forgotten, so a later visit
  // retries it). Responses carry the session they were requested in and are
  // dropped when they arrive after the session has ended.
  const [detailsByMediaId, setDetailsByMediaId] = useState<
    Record<string, MediaPublicDetails | null>
  >({})
  const requestedMediaIds = useRef<Set<string>>(new Set())
  const detailsSession = useRef(0)
  const currentMedia = medias?.[currentIndex] ?? null
  const currentMediaId = currentMedia?.mediaId ?? null
  const loadedDetails = currentMediaId
    ? (detailsByMediaId[currentMediaId] ?? null)
    : null
  // Only details the panel will actually show: an all-null payload must not
  // count as something to show.
  const currentDetails = hasPublicDetailsContent(
    loadedDetails,
    currentMedia?.updatedAt
  )
    ? loadedDetails
    : null
  const currentAltText = currentMedia?.name?.trim() ?? ''
  const hasOverlayContent = Boolean(
    currentAltText || currentDetails || (albumsOwnerId && currentMediaId)
  )
  // The overlay renders only for a photo with something to show; the toggle
  // keeps its state across photos that have nothing.
  const overlayVisible = detailsOpen && hasOverlayContent

  // Keeps focus off <body> when the overlay closes or hides, or the photo
  // changes, while focus was inside it: it moves to the Details button; when
  // that button turns invisible while focused, to the close button.
  useLayoutEffect(() => {
    const active = document.activeElement
    const lostFocus = !active || active === document.body
    const inOverlay =
      Boolean(active && overlayRef.current?.contains(active)) ||
      (focusInOverlay.current && lostFocus)
    const onDetails = active === detailsButtonRef.current
    if (!hasOverlayContent && onDetails) {
      closeButtonRef.current?.focus()
      focusInOverlay.current = false
      return
    }
    if (inOverlay && (!overlayVisible || lostFocus)) {
      const target = hasOverlayContent
        ? detailsButtonRef.current
        : closeButtonRef.current
      target?.focus()
      focusInOverlay.current = false
    }
  }, [overlayVisible, hasOverlayContent, currentMediaId])

  useEffect(() => {
    detailsSession.current += 1
    requestedMediaIds.current = new Set()
    setDetailsByMediaId((current) =>
      Object.keys(current).length ? {} : current
    )
    setDetailsOpen(false)
  }, [medias])

  useEffect(() => {
    if (!currentMediaId || requestedMediaIds.current.has(currentMediaId)) {
      return
    }
    requestedMediaIds.current.add(currentMediaId)
    const session = detailsSession.current
    getMediaPublicDetails(currentMediaId).then(
      (details) => {
        if (session !== detailsSession.current) return
        setDetailsByMediaId((current) => ({
          ...current,
          [currentMediaId]: details
        }))
      },
      () => {
        if (session !== detailsSession.current) return
        requestedMediaIds.current.delete(currentMediaId)
      }
    )
  }, [currentMediaId, medias])

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

  useEffect(() => {
    setModalGifPlaying(null)
    setActiveGifPlaying(false)
  }, [currentIndex, medias])

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
      // A menu or dialog opened over the viewer (the albums menu, "New
      // album") owns Escape and the arrow keys: it has already used Escape to
      // close itself, and an arrow in its fields must not change the photo.
      if (e.defaultPrevented) return
      if (
        e.target instanceof Element &&
        e.target.closest(
          `${ALBUMS_MENU_SELECTOR}, [data-slot="dialog-content"], input, textarea, select`
        )
      ) {
        return
      }
      if (e.key === 'Escape') {
        if (overlayVisible) setDetailsOpen(false)
        else handleClose()
      }
      if (e.key === 'ArrowLeft') handlePrevious()
      if (e.key === 'ArrowRight') handleNext()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [medias, overlayVisible, handleClose, handlePrevious, handleNext])

  useEffect(() => {
    if (medias) {
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
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

  useEffect(() => {
    setModalGifPlaying(null)
  }, [currentIndex])

  if (!mounted || !medias) return null

  const previousIndex = getWrappedIndex(currentIndex - 1)
  const nextIndex = getWrappedIndex(currentIndex + 1)
  const shouldShowNavigation = medias.length > 1
  const visibleIndices = [previousIndex, currentIndex, nextIndex]
  const hasDuplicateVisibleIndices =
    new Set(visibleIndices).size !== visibleIndices.length
  // The same cap for every photo, whatever it carries: the stage between the
  // header (4.25rem) and the thumbnail strip (~5.5rem, 6.5rem from md) with a
  // little room to spare.
  const photoMaxHeight = shouldShowNavigation
    ? 'max-h-[calc(100dvh-11rem)] md:max-h-[calc(100dvh-12rem)]'
    : 'max-h-[calc(100dvh-6rem)]'

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      className="fixed inset-0 z-50 flex flex-col bg-black"
      onPointerDownCapture={() => {
        // A press that starts while the albums menu is open never closes the
        // viewer: outside the menu it only closes the menu, and inside it
        // may be released on the backdrop (a scrollbar drag that overshoots),
        // which dispatches its click on this root.
        swallowBackdropClick.current = Boolean(
          document.querySelector(ALBUMS_MENU_SELECTOR)
        )
      }}
      onClick={() => {
        if (swallowBackdropClick.current) {
          swallowBackdropClick.current = false
          return
        }
        if (overlayVisible) {
          setDetailsOpen(false)
          return
        }
        handleClose()
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-sm text-white">
          {shouldShowNavigation && `${currentIndex + 1} / ${medias.length}`}
        </span>
        <div className="flex items-center gap-1">
          <Button
            ref={detailsButtonRef}
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation()
              setDetailsOpen((open) => !open)
            }}
            aria-expanded={detailsOpen}
            aria-controls={detailsOverlayId}
            aria-hidden={hasOverlayContent ? undefined : true}
            tabIndex={hasOverlayContent ? undefined : -1}
            className={cn(
              'text-white hover:bg-white/20 hover:text-white',
              !hasOverlayContent && 'invisible'
            )}
          >
            <Info className="h-5 w-5" aria-hidden="true" />
            Details
          </Button>
          <Button
            ref={closeButtonRef}
            variant="ghost"
            size="icon"
            onClick={handleClose}
            aria-label="Close media dialog"
            className="text-white hover:bg-white/20 hover:text-white"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="relative flex flex-1 items-center justify-center px-4 md:px-16">
        {currentMedia ? (
          <div
            ref={overlayRef}
            id={detailsOverlayId}
            role="region"
            aria-label="Photo details"
            tabIndex={0}
            hidden={!overlayVisible}
            onClick={(e) => e.stopPropagation()}
            onFocus={() => {
              focusInOverlay.current = true
            }}
            onBlur={(e) => {
              const target = e.target
              queueMicrotask(() => {
                if (target.isConnected) focusInOverlay.current = false
              })
            }}
            className={cn(
              'absolute bottom-3 z-20 mx-auto max-w-2xl space-y-3 divide-y divide-white/10 overflow-y-auto rounded-2xl bg-black/70 p-4 text-left text-white ring-1 ring-white/10 outline-none backdrop-blur-md empty:hidden focus-visible:ring-2 focus-visible:ring-white/60',
              shouldShowNavigation
                ? 'inset-x-3 max-h-[calc(50%-2.5rem)]'
                : 'inset-x-3 max-h-[40%] md:max-h-[50%]'
            )}
          >
            {currentAltText ? (
              <p className="text-sm leading-relaxed text-white/90 select-text">
                <CustomEmojiText text={currentAltText} tags={tags} />
              </p>
            ) : null}
            {currentDetails ? (
              <MediaDetailsPanel
                details={currentDetails}
                ownerName={ownerName}
                attachmentUpdatedAt={currentMedia.updatedAt}
                className="pt-3 first:pt-0"
              />
            ) : null}
            {albumsOwnerId && currentMediaId ? (
              <MediaAlbumsControl
                // Its own load and state for each photo.
                key={currentMediaId}
                mediaId={currentMediaId}
                ownerId={albumsOwnerId}
                variant="pill"
                onChange={onAlbumsChange}
                className="items-start pt-3 first:pt-0"
              />
            ) : null}
          </div>
        ) : null}
        {shouldShowNavigation && (
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation()
                handlePrevious()
              }}
              aria-label="Previous media"
              className="absolute left-2 z-10 h-12 w-12 text-white hover:bg-white/20 hover:text-white md:left-4"
            >
              <ChevronLeft className="h-8 w-8" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation()
                handleNext()
              }}
              aria-label="Next media"
              className="absolute right-2 z-10 h-12 w-12 text-white hover:bg-white/20 hover:text-white md:right-4"
            >
              <ChevronRight className="h-8 w-8" aria-hidden="true" />
            </Button>
          </>
        )}

        <div className="relative flex h-full w-full max-w-[90vw] items-center justify-center">
          <div
            ref={swipeTrackRef}
            className="relative flex h-full w-full items-center justify-center overflow-hidden"
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
              {visibleIndices.map((index, panelIndex) => {
                const isGif = medias[index].mediaType === 'image/gif'
                return (
                  <div
                    key={
                      hasDuplicateVisibleIndices
                        ? `${medias[index].id}-${panelIndex}`
                        : medias[index].id
                    }
                    aria-hidden={panelIndex !== 1}
                    className="flex h-full w-full shrink-0 items-center justify-center"
                  >
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="relative flex max-w-full flex-col items-center justify-center cursor-default"
                    >
                      <div className="relative flex items-center justify-center">
                        <Media
                          allowAutoplay={panelIndex === 1}
                          showVideoControl={panelIndex === 1}
                          manuallyPaused={
                            panelIndex === 1 && modalGifPlaying !== null
                              ? !modalGifPlaying
                              : null
                          }
                          onPlayStateChange={
                            panelIndex === 1 ? setActiveGifPlaying : undefined
                          }
                          className={cn(
                            'max-w-full object-contain',
                            photoMaxHeight
                          )}
                          attachment={medias[index]}
                        />
                        {panelIndex === 1 && isGif && (
                          <button
                            type="button"
                            onClick={() =>
                              setModalGifPlaying(!activeGifPlaying)
                            }
                            aria-label={
                              activeGifPlaying
                                ? 'Pause animation'
                                : 'Play animation'
                            }
                            className="absolute top-2 left-2 z-10 flex size-9 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 backdrop-blur-xs"
                          >
                            {activeGifPlaying ? (
                              <Pause
                                className="size-5 fill-current"
                                aria-hidden="true"
                              />
                            ) : (
                              <Play
                                className="size-5 fill-current ml-0.5"
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Thumbnails */}
      {shouldShowNavigation && (
        <div
          className="flex justify-center gap-2 overflow-x-auto px-4 pb-4 pt-2"
          onClick={(e) => e.stopPropagation()}
        >
          {medias.map((media, index) => (
            <button
              key={media.id}
              onClick={(e) => {
                e.stopPropagation()
                setCurrentIndex(index)
              }}
              aria-current={index === currentIndex ? 'true' : undefined}
              aria-label={
                media.name?.trim()
                  ? `Thumbnail: ${media.name.trim()}`
                  : `Thumbnail ${index + 1}`
              }
              className={cn(
                'relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded border-2 transition-colors md:h-20 md:w-20',
                index === currentIndex
                  ? 'border-primary'
                  : 'border-transparent opacity-60 hover:opacity-100'
              )}
            >
              <Media
                allowAutoplay={false}
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
