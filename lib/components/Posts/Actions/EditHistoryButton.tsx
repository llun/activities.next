import cn from 'classnames'
import formatDistance from 'date-fns/formatDistance'
import { FC, useState } from 'react'

import { StatusData, StatusNote, StatusPoll } from '../../../models/status'
import { Button } from '../../Button'
import { cleanClassName, convertTextContent } from '../../text'
import styles from './EditHistoryButton.module.scss'

interface Props {
  status: StatusNote | StatusPoll
  onShowEdits?: (status: StatusData) => void
}

export const EditHistoryButton: FC<Props> = ({ status, onShowEdits }) => {
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
      <div
        className={cn(styles.history, {
          'd-none': !showHistory
        })}
      >
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
                  {cleanClassName(convertTextContent(edit.text, status.tags))}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </Button>
  )
}