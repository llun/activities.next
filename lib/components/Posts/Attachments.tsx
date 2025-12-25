import { FC } from 'react'

import { Attachment } from '../../models/attachment'
import { Status, StatusType } from '../../models/status'
import { cn } from '@/lib/utils'
import { Media } from './Media'

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
  if (!status.attachments.length) return null

  return (
    <div
      className={cn(
        'grid auto-rows-[10rem] max-md:auto-rows-[8rem] gap-2',
        {
          'grid-cols-2': status.attachments.length > 1,
          '[&>*:first-child]:row-span-2': status.attachments.length === 3
        }
      )}
    >
      {status.attachments.map((attachment, index) => (
        <Media
          className="cursor-pointer object-cover h-full w-full rounded"
          onClick={() => onMediaSelected(status.attachments, index)}
          key={attachment.id}
          attachment={attachment}
        />
      ))}
    </div>
  )
}
