import cn from 'classnames'
import formatDistance from 'date-fns/formatDistance'
import { FC } from 'react'

import { Attachment } from '../../models/attachment'
import { Status } from '../../models/status'
import { parseText } from '../../text'
import { Button } from '../Button'
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
  return (
    <div key={status.id} className={cn('d-flex', styles.post)}>
      <div className={cn('flex-fill', 'me-1')}>
        {parseText(status.text)}
        <Actions {...props} />
      </div>
      <div className={cn('flex-shrink-0', styles.misc)}>
        {formatDistance(status.createdAt, currentTime)}
      </div>
      <div>{attachments.map((a) => a.id)}</div>
    </div>
  )
}
