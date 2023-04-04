import cn from 'classnames'
import { FC } from 'react'

import { AttachmentData } from '../../models/attachment'
import { StatusData, StatusType } from '../../models/status'
import styles from './Attachments.module.scss'
import { Media } from './Media'

interface Props {
  status: StatusData
  onClickMedia: (attachmentData: AttachmentData) => void
}

export const Attachments: FC<Props> = ({ status, onClickMedia }) => {
  if (status.type !== StatusType.Note) return null
  if (!status.attachments.length) return null

  return (
    <div
      className={cn(styles.medias, {
        [styles.grids]: status.attachments.length > 1,
        [styles.three]: status.attachments.length === 3,
        [styles.more]: status.attachments.length > 3
      })}
    >
      {status.attachments.map((attachment) => (
        <Media
          className={styles.media}
          onClick={() => onClickMedia(attachment)}
          key={attachment.id}
          attachment={attachment}
        />
      ))}
    </div>
  )
}
