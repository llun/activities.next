import cn from 'classnames'
import { FC, useState } from 'react'

import { AttachmentData } from '../models/attachment'
import styles from './ActorAttachments.module.scss'
import { Modal } from './Modal'
import { Media } from './Posts/Media'

interface Props {
  className?: string
  attachments: AttachmentData[]
}

export const ActorAttachments: FC<Props> = ({ className, attachments }) => {
  const [modalMedia, setModalMedia] = useState<AttachmentData>()
  const onShowAttachment = (attachment: AttachmentData) =>
    setModalMedia(attachment)

  return (
    <div className={cn(styles.medias, className)}>
      {attachments.map((attachment) => (
        <Media
          className={styles.media}
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
          className={cn(styles.media)}
          attachment={modalMedia}
        />
      </Modal>
    </div>
  )
}
