import cn from 'classnames'
import { formatDistance } from 'date-fns'
import _ from 'lodash'
import { FC } from 'react'

import { convertEmojisToImages } from '@/lib/utils/text/convertEmojisToImages'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'
import { sanitizeText } from '@/lib/utils/text/sanitizeText'

import { ActorProfile } from '../../models/actor'
import { EditableStatus, Status, StatusType } from '../../models/status'
import { cleanClassName } from '../../utils/text/cleanClassName'
import { Actions } from './Actions'
import { Actor } from './Actor'
import { Attachments, OnMediaSelectedHandle } from './Attachments'
import { Poll } from './Poll'
import styles from './Post.module.scss'

export interface PostProps {
  host: string
  currentActor?: ActorProfile
  currentTime: Date
  status: Status
  editable?: boolean
  showActions?: boolean
  onReply?: (status: Status) => void
  onEdit?: (status: EditableStatus) => void
  onPostDeleted?: (status: Status) => void
  onPostReposted?: (status: Status) => void
  onShowAttachment: OnMediaSelectedHandle
}

const getActualStatus = (status: Status) => {
  switch (status.type) {
    case StatusType.enum.Announce:
      return status.originalStatus
    default:
      return status
  }
}

interface BoostStatusProps {
  status: Status
}
export const BoostStatus: FC<BoostStatusProps> = ({ status }) => {
  if (status.type !== StatusType.enum.Announce) return null
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
  const { host, status, currentTime, onShowAttachment } = props
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
        {_.chain(actualStatus.text)
          .thru(status.isLocalActor ? convertMarkdownText(host) : sanitizeText)
          .thru(_.curryRight(convertEmojisToImages)(actualStatus.tags))
          .thru(_.trim)
          .thru(cleanClassName)
          .value()}
      </div>
      <Poll status={actualStatus} currentTime={currentTime} />
      <Attachments status={actualStatus} onMediaSelected={onShowAttachment} />
      <Actions {...props} />
    </div>
  )
}
