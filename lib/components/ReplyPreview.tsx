import cn from 'classnames'
import { FC } from 'react'

import { Status } from '../models/status'
import { parseText } from '../text'
import { CloseButton } from './CloseButton'
import { Actor } from './Posts/Actor'
import styles from './ReplyPreview.module.scss'

interface Props {
  status?: Status
  onClose?: () => void
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
        {parseText(status.text)}
      </div>
      <CloseButton className={cn(styles.close)} onClick={() => onClose?.()} />
    </section>
  )
}
