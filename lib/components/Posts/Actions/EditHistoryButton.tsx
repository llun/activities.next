import { FC } from 'react'

import { StatusData, StatusNote, StatusPoll } from '../../../models/status'
import { Button } from '../../Button'

interface Props {
  status: StatusNote | StatusPoll
  onShowEdits?: (status: StatusData) => void
}

export const EditHistoryButton: FC<Props> = ({ status, onShowEdits }) => {
  if (status.edits.length === 0) return null

  return (
    <Button
      variant="link"
      onClick={() => onShowEdits?.(status)}
      title={`${status.edits.length} edits`}
    >
      <i className="bi bi-eraser" />
    </Button>
  )
}
