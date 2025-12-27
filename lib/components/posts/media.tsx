import { FC, MouseEvent } from 'react'

import { Attachment } from '../../models/attachment'

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
  if (!attachment) {
    return null
  }

  const { mediaType, url, name, id, width, height } = attachment
  if (mediaType.startsWith('image')) {
    return (
      <img
        onClick={onClick}
        key={id}
        className={className}
        alt={caption ?? name ?? url}
        src={url}
        width={width}
        height={height}
      />
    )
  }

  if (mediaType.startsWith('video')) {
    return (
      <video
        className={className}
        width={width}
        height={height}
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
