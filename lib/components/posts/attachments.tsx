import { FC } from 'react'

import { Attachment } from '../../models/attachment'
import { Status, StatusType } from '../../models/status'
import { Media } from './media'

export type OnMediaSelectedHandle = (
  allMedias: Attachment[],
  selectedMediaIndex: number
) => void

interface Props {
  status: Status
  onMediaSelected: OnMediaSelectedHandle
}

export const Attachments: FC<Props> = ({ status, onMediaSelected }) => {
  if (status.type !== StatusType.enum.Note) return null
  const { attachments } = status
  if (!attachments.length) return null

  const handleClick = (index: number) => {
    onMediaSelected(attachments, index)
  }

  // 1 Media
  if (attachments.length === 1) {
    return (
      <div className="mt-3 overflow-hidden rounded-xl border border-border/60 bg-muted/20">
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleClick(0)
          }}
          className="relative block aspect-video w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Media
            className="h-full w-full object-cover"
            attachment={attachments[0]}
          />
        </button>
      </div>
    )
  }

  // 2 Media
  if (attachments.length === 2) {
    return (
      <div className="mt-3 grid grid-cols-2 gap-1 overflow-hidden rounded-xl border border-border/60 bg-muted/20">
        {attachments.map((attachment, i) => (
          <button
            key={attachment.id}
            onClick={(e) => {
              e.stopPropagation()
              handleClick(i)
            }}
            className="relative aspect-square cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Media
              className="h-full w-full object-cover"
              attachment={attachment}
            />
          </button>
        ))}
      </div>
    )
  }

  // 3 Media
  if (attachments.length === 3) {
    return (
      <div className="mt-3 grid grid-cols-2 gap-1 overflow-hidden rounded-xl border border-border/60 bg-muted/20">
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleClick(0)
          }}
          className="relative aspect-square cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Media
            className="h-full w-full object-cover"
            attachment={attachments[0]}
          />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleClick(2)
          }}
          className="relative row-span-2 h-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Media
            className="h-full w-full object-cover"
            attachment={attachments[2]}
          />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleClick(1)
          }}
          className="relative aspect-square cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Media
            className="h-full w-full object-cover"
            attachment={attachments[1]}
          />
        </button>
      </div>
    )
  }

  // 4+ Media
  const displayMedia = attachments.slice(0, 4)
  const remainingCount = attachments.length - 4

  return (
    <div className="mt-3 grid grid-cols-2 gap-1 overflow-hidden rounded-xl border border-border/60 bg-muted/20">
      {displayMedia.map((attachment, i) => (
        <button
          key={attachment.id}
          onClick={(e) => {
            e.stopPropagation()
            handleClick(i)
          }}
          className="relative aspect-square cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Media
            className="h-full w-full object-cover"
            attachment={attachment}
          />
          {i === 3 && remainingCount > 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <span className="text-2xl font-semibold text-white">
                +{remainingCount}
              </span>
            </div>
          )}
        </button>
      ))}
    </div>
  )
}
