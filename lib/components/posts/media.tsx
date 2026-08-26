'use client'

import {
  CSSProperties,
  FC,
  MouseEvent,
  useEffect,
  useRef,
  useState
} from 'react'

import { Attachment } from '@/lib/types/domain/attachment'
import { cn } from '@/lib/utils'
import { focalPointToCssObjectPosition } from '@/lib/utils/focalPoint'

import { BlurhashCanvas } from './BlurhashCanvas'

interface Props {
  caption?: string
  className?: string
  attachment?: Attachment
  showVideoControl?: boolean
  /**
   * Pass `'lazy'` from a surface that renders an unbounded number of media at
   * once — a post's media strip holds every attachment, so a photo dump is
   * otherwise a request per photo for pictures nobody has scrolled to. Leave it
   * unset for a surface showing one image: an in-viewport lazy image is fetched
   * at a lower priority, which is exactly the wrong trade for a post's largest
   * element.
   *
   * It reaches a video as `preload="none"`, since `loading` is an image-only
   * attribute: left alone a `<video>` defaults to fetching `metadata`, so a
   * strip of twenty clips is twenty range requests for videos nobody has
   * scrolled to. That only applies to a video carrying a `poster`, though —
   * see the `preload` line below. The poster itself is fetched either way,
   * nothing declarative defers it, but that is one image request each, the
   * same as a photo, and the strip hides its controls anyway, so losing the
   * preloaded duration costs nothing.
   */
  loading?: 'lazy' | 'eager'
  onClick?: (event: MouseEvent) => void
}

export const Media: FC<Props> = ({
  className,
  caption,
  attachment,
  showVideoControl = false,
  loading,
  onClick
}) => {
  const [isLoaded, setIsLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setIsLoaded(true)
    } else {
      setIsLoaded(false)
    }
  }, [attachment?.url])

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
    thumbnailUrl
  } = attachment
  const objectPosition = focalPointToCssObjectPosition(focus)
  const style: CSSProperties = { objectPosition }
  const aspectRatio =
    width && height && width > 0 && height > 0
      ? `${width} / ${height}`
      : undefined

  if (mediaType.startsWith('image')) {
    if (blurhash) {
      return (
        <div
          className={cn('relative overflow-hidden', className)}
          style={{ aspectRatio }}
        >
          <BlurhashCanvas
            blurhash={blurhash}
            style={style}
            className={cn(
              'absolute inset-0 h-full w-full object-cover transition-opacity duration-300 pointer-events-none',
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
              'h-full w-full transition-opacity duration-300',
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
        onClick={onClick}
        key={id}
        loading={loading}
        className={className}
        style={style}
        alt={caption ?? name ?? url}
        src={url}
        width={width}
        height={height}
      />
    )
  }

  if (mediaType.startsWith('video')) {
    const poster = thumbnailUrl ?? undefined
    return (
      <video
        className={className}
        style={style}
        width={width}
        height={height}
        poster={poster}
        // Only skip the fetch when there is a poster to paint instead. With no
        // poster this element's ONLY way to show anything before playback is
        // the `#t=0.01` fragment below, which needs metadata to decode a frame
        // — and the strip hides its controls, so `preload="none"` would leave a
        // bare empty box. Federated video always lands here: `thumbnailUrl` is
        // written on the local-upload path alone.
        preload={loading === 'lazy' && poster ? 'none' : undefined}
        controls={showVideoControl}
        onClick={(event) => {
          // Don't play the video here
          event.preventDefault()
          onClick?.(event)
        }}
      >
        <source src={`${url}#t=0.01`} type={mediaType} />
      </video>
    )
  }

  if (mediaType.startsWith('audio')) {
    return (
      <audio
        className={className}
        controls
        onClick={(event) => {
          // Don't audio the video here
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
