import cn from 'classnames'
import { FC } from 'react'

import { CloseButton } from '@/lib/components/CloseButton'
import { Actor } from '@/lib/components/Posts/Actor'
import { Poll } from '@/lib/components/Posts/Poll'
import { EditableStatus, Status, StatusType } from '@/lib/models/status'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { convertEmojisToImages } from '@/lib/utils/text/convertEmojisToImages'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'

import styles from './ReplyPreview.module.scss'

interface Props {
  host: string
  status?: Status
  onClose?: () => void
}

const getText = (status: Status) => {
  switch (status.type) {
    case StatusType.enum.Note:
    case StatusType.enum.Poll:
      return status.text
    case StatusType.enum.Announce:
      return status.originalStatus.text
    default:
      return ''
  }
}

const getTags = (status: Status) => {
  switch (status.type) {
    case StatusType.enum.Note:
    case StatusType.enum.Poll:
      return status.tags
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
          (status as EditableStatus).isLocalActor
            ? convertMarkdownText(host)(getText(status))
            : convertEmojisToImages(getText(status), getTags(status))
        )}
        <Poll status={status} currentTime={new Date()} />
      </div>
      <CloseButton className={cn(styles.close)} onClick={() => onClose?.()} />
    </section>
  )
}
