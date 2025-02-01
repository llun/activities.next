import cn from 'classnames'
import { formatDistance } from 'date-fns'
import { FC, useState } from 'react'

import { Button } from '@/lib/components/Button'
import { Status, StatusNote, StatusPoll } from '@/lib/models/status'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { convertEmojisToImages } from '@/lib/utils/text/convertEmojisToImages'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'

import styles from './EditHistoryButton.module.scss'

interface Props {
  host: string
  status: StatusNote | StatusPoll
  onShowEdits?: (status: Status) => void
}

export const EditHistoryButton: FC<Props> = ({ host, status, onShowEdits }) => {
  const [showHistory, setShowHistory] = useState<boolean>(false)

  if (status.edits.length === 0) return null

  return (
    <Button
      className={styles.button}
      variant="link"
      onClick={() => {
        onShowEdits?.(status)
        setShowHistory((value) => !value)
      }}
      title={`${status.edits.length} edits`}
    >
      <i className="bi bi-eraser" />
      {showHistory && (
        <div className={cn(styles.history)}>
          <ul className="list-group">
            {status.edits.reverse().map((edit, index) => {
              return (
                <li
                  key={edit.createdAt + index}
                  className={cn(
                    'list-group-item',
                    'd-flex',
                    'flex-column',
                    'align-items-start'
                  )}
                >
                  <div className="badge bg-primary rounded-pill align-self-end">
                    {formatDistance(edit.createdAt, Date.now())}
                  </div>
                  <div className="me-auto text-start">
                    {cleanClassName(
                      status.isLocalActor
                        ? convertMarkdownText(host)(edit.text)
                        : convertEmojisToImages(edit.text, status.tags)
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Button>
  )
}
