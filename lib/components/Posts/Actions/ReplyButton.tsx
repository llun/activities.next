import { FC } from 'react'

import { StatusData } from '@/lib/models/status'
import { Button } from '../../Button'

interface Props {
  className?: string
  status: StatusData
  onReply?: (status: StatusData) => void
}

export const ReplyButton: FC<Props> = ({ className, status, onReply }) => {
  return (
    <Button
      className={className}
      variant="link"
      title="Reply"
      onClick={() => onReply?.(status)}
    >
      <i className="bi bi-reply" />
    </Button>
  )
}
