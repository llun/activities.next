import cn from 'classnames'
import { FC, useState } from 'react'

import { StatusData, StatusNote, StatusPoll } from '../../../models/status'
import { Button } from '../../Button'
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
        HistoryPopup
      </div>
    </Button>
  )
}
