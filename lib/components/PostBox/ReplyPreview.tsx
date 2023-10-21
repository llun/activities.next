import cn from 'classnames'
import { FC } from 'react'

import { StatusData, StatusType } from '../../models/status'
import { CloseButton } from '../CloseButton'
import { Actor } from '../Posts/Actor'
import { Poll } from '../Posts/Poll'
import { cleanClassName, convertTextContent } from '../text'
import styles from './ReplyPreview.module.scss'

interface Props {
  status?: StatusData
  onClose?: () => void
}

const getText = (statusData: StatusData) => {
  console.log('Status data = ', statusData)
  switch (statusData.type) {
    case StatusType.Note:
    case StatusType.Poll:
      return statusData.text
    case StatusType.Announce:
      return statusData.originalStatus.text
    default:
      return ''
  }
}

const getTags = (statusData: StatusData) => {
  switch (statusData.type) {
    case StatusType.Note:
    case StatusType.Poll:
      return statusData.tags
    default:
      return []
  }
}

export const ReplyPreview: FC<Props> = ({ status, onClose }) => {
  if (!status) return null
  return (
    <section
      className={cn(
        styles.card,
        'card',
        'mb-4',
        'py-2',
        'px-4',
        'text-bg-light'
      )}
    >
      <div>
        <Actor actorId={status.actorId || ''} />
        {cleanClassName(convertTextContent(getText(status), getTags(status)))}
        <Poll status={status} currentTime={new Date()} />
      </div>
      <CloseButton className={cn(styles.close)} onClick={() => onClose?.()} />
    </section>
  )
}
