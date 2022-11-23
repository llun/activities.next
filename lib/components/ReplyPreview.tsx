import cn from 'classnames'
import { FC } from 'react'

import { Status } from '../models/status'
import { parseText } from '../text'
import styles from './ReplyPreview.module.scss'

interface Props {
  status?: Status
}

export const ReplyPreview: FC<Props> = ({ status }) => {
  if (!status) return null
  return (
    <div className={cn(styles.card, 'card', 'mb-4', 'p-4', 'text-bg-light')}>
      {parseText(status.text)}
    </div>
  )
}
