import cn from 'classnames'
import { FC } from 'react'

import { StatusData, StatusType } from '../../models/status'
import { cleanClassName } from '../../utils/text/cleanClassName'
import { convertTextContent } from '../../utils/text/convertTextContent'
import { CloseButton } from '../CloseButton'
import { Actor } from '../Posts/Actor'
import { Poll } from '../Posts/Poll'
import styles from './ReplyPreview.module.scss'

interface Props {
  host: string
  status?: StatusData
  onClose?: () => void
}

const getText = (statusData: StatusData) => {
  switch (statusData.type) {
    case StatusType.enum.Note:
    case StatusType.enum.Poll:
      return statusData.text
    case StatusType.enum.Announce:
      return statusData.originalStatus.text
    default:
      return ''
  }
}

const getTags = (statusData: StatusData) => {
  switch (statusData.type) {
    case StatusType.enum.Note:
    case StatusType.enum.Poll:
      return statusData.tags
    default:
      return []
  }
}

export const ReplyPreview: FC<Props> = ({ host, status, onClose }) => {
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
        {cleanClassName(
          convertTextContent(host, getText(status), getTags(status))
        )}
        <Poll status={status} currentTime={new Date()} />
      </div>
      <CloseButton className={cn(styles.close)} onClick={() => onClose?.()} />
    </section>
  )
}
