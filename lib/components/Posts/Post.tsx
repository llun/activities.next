import cn from 'classnames'
import formatDistance from 'date-fns/formatDistance'
import { FC } from 'react'

import { deleteStatus, repostStatus } from '../../client'
import { AttachmentData } from '../../models/attachment'
import { StatusData, StatusType } from '../../models/status'
import { parseText } from '../../text'
import { Button } from '../Button'
import { Actor } from './Actor'
import { Media } from './Media'
import styles from './Post.module.scss'

interface Props {
  showActorId?: boolean
  currentTime: Date
  status: StatusData
  showDeleteAction?: boolean
  showActions?: boolean
  onReply?: (status: StatusData) => void
  onPostDeleted?: (status: StatusData) => void
  onPostReposted?: (status: StatusData) => void
  onShowAttachment: (attachment: AttachmentData) => void
}

export const Actions: FC<Props> = ({
  status,
  showDeleteAction = false,
  showActions = false,
  onReply,
  onPostDeleted,
  onPostReposted
}) => {
  if (!showActions) return null
  // TODO: Return different actions for announce
  if (status.type === StatusType.Announce) return null
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
        onClick={async () => {
          await repostStatus({ statusId: status.id })
          onPostReposted?.(status)
        }}
      >
        <i className="bi bi bi-repeat"></i>
      </Button>
      {showDeleteAction && (
        <Button
          className={styles.action}
          variant="link"
          onClick={async () => {
            const deleteConfirmation = window.confirm(
              `Confirm delete status! ${
                status.text.length
                  ? `${status.text.slice(0, 20)}...`
                  : status.id
              }`
            )
            if (!deleteConfirmation) return
            await deleteStatus({ statusId: status.id })
            onPostDeleted?.(status)
          }}
        >
          <i className="bi bi-trash3"></i>
        </Button>
      )}
    </div>
  )
}

const getActualStatus = (status: StatusData) => {
  switch (status.type) {
    case StatusType.Announce:
      return status.originalStatus
    default:
      return status
  }
}

interface BoostStatusProps {
  status: StatusData
}
const BoostStatus: FC<BoostStatusProps> = ({ status }) => {
  if (status.type !== StatusType.Announce) return null
  return (
    <div className="d-flex mb-1">
      <i className="bi bi-repeat me-2"></i>
      <span className="me-2">Boost by</span>
      <Actor actorId={status.actorId} />
    </div>
  )
}

export const Post: FC<Props> = (props) => {
  const { showActorId = false, status, currentTime, onShowAttachment } = props
  const actualStatus = getActualStatus(status)
  return (
    <div key={status.id} className={cn(styles.post)}>
      <BoostStatus status={status} />
      <div className={cn('d-flex', 'mb-2')}>
        <Actor
          className={cn('flex-fill', 'me-2')}
          actor={status.actor}
          actorId={(showActorId && actualStatus.actorId) || ''}
        />
        <div className={cn('flex-shrink-0', styles.misc)}>
          <a href={actualStatus.url} target="_blank" rel="noreferrer">
            {formatDistance(actualStatus.createdAt, currentTime)}
          </a>
        </div>
      </div>
      <div className={'me-1'}>{parseText(actualStatus.text)}</div>
      {actualStatus.attachments && actualStatus.attachments.length > 0 && (
        <div
          className={cn(styles.medias)}
          style={{
            gridTemplateColumns: `repeat(${
              actualStatus.attachments.length > 1 ? 2 : 1
            }, 1fr)`
          }}
        >
          {actualStatus.attachments.map((attachment) => (
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
