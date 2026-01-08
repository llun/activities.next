import { FC, useState } from 'react'

import { cn } from '@/lib/utils'

import { Attachment } from '../../models/attachment'
import { Modal } from '../modal/modal'
import { Media } from '../posts/media'

interface Props {
  className?: string
  attachments: Attachment[]
}

export const ActorAttachments: FC<Props> = ({ className, attachments }) => {
  const [modalMedia, setModalMedia] = useState<Attachment>()
  const onShowAttachment = (attachment: Attachment) => setModalMedia(attachment)

  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3',
        className
      )}
    >
      {attachments.map((attachment) => (
        <Media
          className="cursor-pointer object-cover w-full h-auto aspect-square"
          onClick={() => onShowAttachment(attachment)}
          key={attachment.id}
          attachment={attachment}
        />
      ))}
      <Modal
        isOpen={Boolean(modalMedia)}
        onRequestClose={() => setModalMedia(undefined)}
      >
        <Media
          showVideoControl
          className="cursor-pointer object-cover w-full h-auto aspect-square"
          attachment={modalMedia}
        />
      </Modal>
    </div>
  )
}
