import cn from 'classnames'
import { FC } from 'react'

import { AttachmentData } from '../../models/attachment'
import { Status, StatusType } from '../../models/status'
import styles from './Attachments.module.scss'
import { Media } from './Media'

export type OnMediaSelectedHandle = (
  allMedias: AttachmentData[],
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
      className={cn(styles.medias, {
        [styles.grids]: status.attachments.length > 1,
        [styles.three]: status.attachments.length === 3,
        [styles.more]: status.attachments.length > 3
      })}
    >
      {status.attachments.map((attachment, index) => (
        <Media
          className={styles.media}
          onClick={() => onMediaSelected(status.attachments, index)}
          key={attachment.id}
          attachment={attachment}
        />
      ))}
    </div>
  )
}
