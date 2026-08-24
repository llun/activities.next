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
  onClick?: (event: MouseEvent) => void
}

export const Media: FC<Props> = ({
  className,
  caption,
  attachment,
  showVideoControl = false,
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

  if (mediaType.startsWith('image')) {
    if (blurhash) {
      return (
        <div className={cn('relative overflow-hidden', className)}>
          <BlurhashCanvas
            blurhash={blurhash}
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
