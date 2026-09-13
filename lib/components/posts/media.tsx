'use client'

import {
  CSSProperties,
  FC,
  MouseEvent,
  useEffect,
  useRef,
  useState
} from 'react'

import { usePlaybackPreferences } from '@/lib/components/preferences/PlaybackPreferencesContext'
import { Attachment } from '@/lib/types/domain/attachment'
import { cn } from '@/lib/utils'
import { focalPointToCssObjectPosition } from '@/lib/utils/focalPoint'

import { BlurhashCanvas } from './BlurhashCanvas'

export interface Props {
  caption?: string
  className?: string
  attachment?: Attachment
  showVideoControl?: boolean
  loading?: 'lazy' | 'eager'
  onClick?: (event: MouseEvent) => void
  allowAutoplay?: boolean
  manuallyPaused?: boolean | null
  isPlaying?: boolean
  onPlayStateChange?: (playing: boolean) => void
}

export const Media: FC<Props> = ({
  className,
  caption,
  attachment,
  showVideoControl = false,
  loading,
  onClick,
  allowAutoplay = true,
  manuallyPaused = null,
  isPlaying: isPlayingProp,
  onPlayStateChange
}) => {
  const { autoplayGifs } = usePlaybackPreferences()
  const [isLoaded, setIsLoaded] = useState(false)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const [isIntersecting, setIsIntersecting] = useState(true)
  const [isDocumentVisible, setIsDocumentVisible] = useState(true)

  const imgRef = useRef<HTMLImageElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const isGifv = attachment?.playbackType === 'gifv'
  const isGif = attachment?.mediaType === 'image/gif'
  const isAnimation = isGifv || isGif

  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setIsLoaded(true)
    } else {
      setIsLoaded(false)
    }
  }, [attachment?.url])

  // Motion preference listener and mount detection
  useEffect(() => {
    setIsMounted(true)
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return
    }
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReducedMotion(mediaQuery.matches)

    const handler = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches)
    }
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  // Document visibility listener
  useEffect(() => {
    if (typeof document === 'undefined') return
    const updateVisibility = () => {
      setIsDocumentVisible(document.visibilityState !== 'hidden')
    }
    updateVisibility()
    document.addEventListener('visibilitychange', updateVisibility)
    return () =>
      document.removeEventListener('visibilitychange', updateVisibility)
  }, [])

  // Intersection observer for animation playback
  useEffect(() => {
    if (!isAnimation) return
    const target = videoRef.current || containerRef.current || imgRef.current
    if (!target || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setIsIntersecting(entry.isIntersecting)
        }
      },
      { threshold: 0 }
    )

    observer.observe(target)
    return () => observer.disconnect()
  }, [isAnimation, attachment?.id])

  // Compute whether this animation should currently play
  const shouldAutoplay = allowAutoplay && autoplayGifs && !prefersReducedMotion
  const eligibleToPlay =
    manuallyPaused === false
      ? true
      : manuallyPaused === true
        ? false
        : shouldAutoplay

  const effectiveShouldPlay =
    isAnimation &&
    isMounted &&
    (isPlayingProp !== undefined
      ? isPlayingProp
      : eligibleToPlay && isIntersecting && isDocumentVisible)

  // Manage video playback for GIFV
  useEffect(() => {
    if (!isGifv) return
    const video = videoRef.current
    if (!video) return

    if (effectiveShouldPlay) {
      if (typeof video.play === 'function') {
        const playPromise = video.play()
        if (
          playPromise !== undefined &&
          typeof playPromise.then === 'function'
        ) {
          playPromise
            .then(() => {
              onPlayStateChange?.(true)
            })
            .catch(() => {
              onPlayStateChange?.(false)
            })
        } else {
          onPlayStateChange?.(true)
        }
      }
    } else {
      if (typeof video.pause === 'function') {
        video.pause()
      }
      onPlayStateChange?.(false)
    }

    return () => {
      if (typeof video.pause === 'function') {
        video.pause()
      }
    }
  }, [
    effectiveShouldPlay,
    isGifv,
    attachment?.id,
    attachment?.url,
    onPlayStateChange
  ])

  // Manage GIF play state change notifications
  useEffect(() => {
    if (!isGif) return
    onPlayStateChange?.(effectiveShouldPlay)
  }, [effectiveShouldPlay, isGif, onPlayStateChange])

  if (!attachment) {
    return null
  }

  const {
    mediaType,
    url,
    name,
    id,
    width,
    height,
    blurhash,
    focus,
    thumbnailUrl,
    playbackType
  } = attachment

  const objectPosition = focalPointToCssObjectPosition(focus)
  const style: CSSProperties = { objectPosition }
  const aspectRatio =
    width && height && width > 0 && height > 0
      ? `${width} / ${height}`
      : undefined

  // 1. GIFV animation
  if (playbackType === 'gifv') {
    const poster = thumbnailUrl ?? undefined
    return (
      <video
        key={id}
        ref={(node) => {
          videoRef.current = node
          if (node) {
            node.muted = true
          }
        }}
        className={cn('rounded-[inherit]', className)}
        style={style}
        width={width}
        height={height}
        poster={poster}
        preload={loading === 'lazy' && poster ? 'none' : 'auto'}
        muted
        loop
        playsInline
        controls={showVideoControl}
        aria-label={caption ?? name ?? 'Animated GIF'}
        onClick={(event) => {
          // Don't trigger default video play on tap if clicking outside controls
          if (!showVideoControl) {
            event.preventDefault()
          }
          onClick?.(event)
        }}
      >
        <source src={url} type={mediaType} />
      </video>
    )
  }

  // 2. Real image/gif
  if (mediaType === 'image/gif') {
    const staticUrl = thumbnailUrl || (blurhash ? undefined : url)

    if (!effectiveShouldPlay && staticUrl) {
      return (
        <div
          ref={containerRef}
          className={cn(
            'relative overflow-hidden rounded-[inherit]',
            className
          )}
          style={{ aspectRatio }}
        >
          {blurhash && (
            <BlurhashCanvas
              blurhash={blurhash}
              style={style}
              className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300 pointer-events-none rounded-[inherit]"
            />
          )}
          <img
            onClick={onClick}
            key={`paused-${id}`}
            loading={loading}
            className={cn(
              'h-full w-full rounded-[inherit]',
              className?.includes('object-contain')
                ? 'object-contain'
                : 'object-cover'
            )}
            style={style}
            alt={caption ?? name ?? url}
            src={staticUrl}
            width={width}
            height={height}
          />
        </div>
      )
    }

    if (!effectiveShouldPlay && blurhash) {
      return (
        <div
          ref={containerRef}
          role="img"
          aria-label={caption ?? name ?? 'Animated GIF'}
          className={cn(
            'relative overflow-hidden rounded-[inherit]',
            className
          )}
          style={{ aspectRatio }}
          onClick={onClick}
        >
          <BlurhashCanvas
            blurhash={blurhash}
            style={style}
            className="absolute inset-0 h-full w-full object-cover rounded-[inherit]"
          />
        </div>
      )
    }

    return (
      <div
        ref={containerRef}
        className={cn('relative overflow-hidden rounded-[inherit]', className)}
        style={{ aspectRatio }}
      >
        <img
          ref={(node) => {
            imgRef.current = node
          }}
          onClick={onClick}
          key={id}
          loading={loading}
          className={cn(
            'h-full w-full rounded-[inherit]',
            className?.includes('object-contain')
              ? 'object-contain'
              : 'object-cover'
          )}
          style={style}
          alt={caption ?? name ?? url}
          src={url}
          width={width}
          height={height}
        />
      </div>
    )
  }

  // 3. Standard images
  if (mediaType.startsWith('image')) {
    if (blurhash) {
      return (
        <div
          ref={containerRef}
          className={cn(
            'relative overflow-hidden rounded-[inherit]',
            className
          )}
          style={{ aspectRatio }}
        >
          <BlurhashCanvas
            blurhash={blurhash}
            style={style}
            className={cn(
              'absolute inset-0 h-full w-full object-cover transition-opacity duration-300 pointer-events-none rounded-[inherit]',
              isLoaded ? 'opacity-0' : 'opacity-100'
            )}
          />
          <img
            ref={(node) => {
              imgRef.current = node
              if (node?.complete && node.naturalWidth > 0 && !isLoaded) {
                setIsLoaded(true)
              }
            }}
            onClick={onClick}
            key={id}
            loading={loading}
            className={cn(
              'h-full w-full transition-opacity duration-300 rounded-[inherit]',
              className?.includes('object-contain')
                ? 'object-contain'
                : 'object-cover',
              isLoaded ? 'opacity-100' : 'opacity-0'
            )}
            style={style}
            alt={caption ?? name ?? url}
            src={url}
            width={width}
            height={height}
            onLoad={() => setIsLoaded(true)}
          />
        </div>
      )
    }

    return (
      <img
        ref={(node) => {
          imgRef.current = node
        }}
        onClick={onClick}
        key={id}
        loading={loading}
        className={cn('rounded-[inherit]', className)}
        style={style}
        alt={caption ?? name ?? url}
        src={url}
        width={width}
        height={height}
      />
    )
  }

  // 4. Ordinary videos
  if (mediaType.startsWith('video')) {
    const poster = thumbnailUrl ?? undefined
    return (
      <video
        ref={videoRef}
        className={cn('rounded-[inherit]', className)}
        style={style}
        width={width}
        height={height}
        poster={poster}
        preload={loading === 'lazy' && poster ? 'none' : undefined}
        controls={showVideoControl}
        onClick={(event) => {
          event.preventDefault()
          onClick?.(event)
        }}
      >
        <source src={`${url}#t=0.01`} type={mediaType} />
      </video>
    )
  }

  // 5. Audios
  if (mediaType.startsWith('audio')) {
    return (
      <audio
        className={className}
        controls
        onClick={(event) => {
          event.preventDefault()
          onClick?.(event)
        }}
      >
        <source src={url} type={mediaType} />
      </audio>
    )
  }

  return null
}
