import cn from 'classnames'
import formatDistance from 'date-fns/formatDistance'
import { FC } from 'react'

import { ActorProfile } from '../../models/actor'
import { AttachmentData } from '../../models/attachment'
import { StatusData, StatusType } from '../../models/status'
import { cleanClassName, convertTextContent } from '../text'
import { Actions } from './Actions'
import { Actor } from './Actor'
import { Media } from './Media'
import styles from './Post.module.scss'

export interface PostProps {
  currentActor?: ActorProfile
  currentTime: Date
  status: StatusData
  showDeleteAction?: boolean
  showActions?: boolean
  onReply?: (status: StatusData) => void
  onPostDeleted?: (status: StatusData) => void
  onPostReposted?: (status: StatusData) => void
  onShowAttachment: (attachment: AttachmentData) => void
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
    <div className={cn('d-flex', 'mb-1', 'align-items-center')}>
      <i className="bi bi-repeat me-2"></i>
      <span className="me-2 text-nowrap">Boost by</span>
      <Actor
        className={cn('flex-grow-1')}
        actor={status.actor}
        actorId={status.actorId}
      />
    </div>
  )
}

export const Post: FC<PostProps> = (props) => {
  const { status, currentTime, onShowAttachment } = props
  const actualStatus = getActualStatus(status)
  return (
    <div key={status.id} className={cn(styles.post)}>
      <BoostStatus status={status} />
      <div className={cn('d-flex', 'mb-2')}>
        <Actor
          className={cn('flex-grow-1', 'overflow-hidden', 'me-2')}
          actor={actualStatus.actor}
          actorId={actualStatus.actorId}
        />
        <div className={cn('flex-shrink-0', styles.misc)}>
          <a href={actualStatus.url} target="_blank" rel="noreferrer">
            {formatDistance(actualStatus.createdAt, currentTime)}
          </a>
        </div>
      </div>
      <div className={'me-1 text-break'}>
        {cleanClassName(
          convertTextContent(actualStatus.text, actualStatus.tags)
        )}
      </div>
      {actualStatus.type === StatusType.Note &&
        actualStatus.attachments &&
        actualStatus.attachments.length > 0 && (
          <div
            className={cn(styles.medias, {
              [styles.grids]: actualStatus.attachments.length > 1,
              [styles.three]: actualStatus.attachments.length === 3,
              [styles.more]: actualStatus.attachments.length > 3
            })}
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
