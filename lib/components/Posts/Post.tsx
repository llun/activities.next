import cn from 'classnames'
import formatDistance from 'date-fns/formatDistance'
import { FC, useState } from 'react'
import ReactModal from 'react-modal'

import { Attachment } from '../../models/attachment'
import { Status } from '../../models/status'
import { parseText } from '../../text'
import { Button } from '../Button'
import { Media } from './Media'
import styles from './Post.module.scss'

interface Props {
  currentTime: Date
  status: Status
  attachments: Attachment[]
  showActions?: boolean
  onReply?: (status: Status) => void
}

export const Actions: FC<Props> = ({
  status,
  showActions = false,
  onReply
}) => {
  if (!showActions) return null
  return (
    <div className={cn(styles.actions)}>
      <Button
        className={styles.action}
        variant="link"
        onClick={() => onReply?.(status)}
      >
        <i className="bi bi-reply"></i>
      </Button>
      <Button
        className={styles.action}
        variant="link"
        onClick={() => {
          console.log('Repost')
        }}
      >
        <i className="bi bi-arrow-left-right"></i>
      </Button>
    </div>
  )
}

export const Post: FC<Props> = (props) => {
  const { status, currentTime, attachments = [] } = props
  const [modalMedia, setModalMedia] = useState<Attachment | null>(null)
  return (
    <div key={status.id} className={cn(styles.post)}>
      <div className={cn('d-flex')}>
        <div className={cn('flex-fill', 'me-1')}>{parseText(status.text)}</div>
        {/* <div className={cn('flex-shrink-0', styles.misc)}>
          {formatDistance(status.createdAt, currentTime)}
        </div> */}
      </div>
      {attachments.length > 0 && (
        <div
          className={cn(styles.medias)}
          style={{
            gridTemplateColumns: `repeat(${
              attachments.length > 1 ? 2 : 1
            }, 1fr)`
          }}
        >
          {attachments.map((attachment) => (
            <Media
              className={styles.media}
              onClick={() => setModalMedia(attachment)}
              key={attachment.id}
              attachment={attachment}
            />
          ))}
        </div>
      )}
      <Actions {...props} />
      {attachments.length > 0 && (
        <ReactModal
          className={cn(styles.modal)}
          isOpen={Boolean(modalMedia)}
          onRequestClose={() => setModalMedia(null)}
        >
          {modalMedia && (
            <Media
              showVideoControl
              className={cn(styles.selectedMedia)}
              attachment={modalMedia}
            />
          )}
        </ReactModal>
      )}
    </div>
  )
}
