import cn from 'classnames'
import formatDistance from 'date-fns/formatDistance'
import { FC } from 'react'

import { deleteStatus } from '../../client'
import { AttachmentData } from '../../models/attachment'
import { StatusData } from '../../models/status'
import { parseText } from '../../text'
import { Button } from '../Button'
import { Actor } from './Actor'
import { Media } from './Media'
import styles from './Post.module.scss'

interface Props {
  showActorId?: boolean
  currentTime: Date
  status: StatusData
  showActions?: boolean
  onReply?: (status: StatusData) => void
  onPostDeleted?: (status: StatusData) => void
  onShowAttachment: (attachment: AttachmentData) => void
}

export const Actions: FC<Props> = ({
  status,
  showActions = false,
  onReply,
  onPostDeleted
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
      <Button
        className={styles.action}
        variant="link"
        onClick={async () => {
          const deleteConfirmation = window.confirm(
            `Confirm delete status! ${
              status.text.length ? `${status.text.slice(0, 20)}...` : status.id
            }`
          )
          if (!deleteConfirmation) return
          await deleteStatus({ statusId: status.id })
          onPostDeleted?.(status)
        }}
      >
        <i className="bi bi-trash3"></i>
      </Button>
    </div>
  )
}

export const Post: FC<Props> = (props) => {
  const { showActorId = false, status, currentTime, onShowAttachment } = props
  return (
    <div key={status.id} className={cn(styles.post)}>
      <div className={cn('d-flex', 'mb-2')}>
        <Actor
          className={cn('flex-fill', 'me-2')}
          actorId={(showActorId && status.actorId) || ''}
        />
        <div className={cn('flex-shrink-0', styles.misc)}>
          <a href={status.url} target="_blank" rel="noreferrer">
            {formatDistance(status.createdAt, currentTime)}
          </a>
        </div>
      </div>
      <div className={'me-1'}>{parseText(status.text)}</div>
      {status.attachments && status.attachments.length > 0 && (
        <div
          className={cn(styles.medias)}
          style={{
            gridTemplateColumns: `repeat(${
              status.attachments.length > 1 ? 2 : 1
            }, 1fr)`
          }}
        >
          {status.attachments.map((attachment) => (
            <Media
              className={styles.media}
              onClick={() => onShowAttachment(attachment)}
              key={attachment.id}
              attachment={attachment}
            />
          ))}
        </div>
      )}
      <Actions {...props} />
    </div>
  )
}
