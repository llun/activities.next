import cn from 'classnames'
import { FC } from 'react'

import { StatusData, StatusType } from '../../models/status'
import { CloseButton } from '../CloseButton'
import { Actor } from '../Posts/Actor'
import { cleanClassName } from '../text'
import styles from './ReplyPreview.module.scss'

interface Props {
  status?: StatusData
  onClose?: () => void
}

const getText = (statusData: StatusData) => {
  switch (statusData.type) {
    case StatusType.Note:
      return statusData.text
    case StatusType.Announce:
      return statusData.originalStatus.text
    default:
      return ''
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
        {cleanClassName(getText(status))}
      </div>
      <CloseButton className={cn(styles.close)} onClick={() => onClose?.()} />
    </section>
  )
}
