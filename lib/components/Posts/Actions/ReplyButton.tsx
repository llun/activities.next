import { FC } from 'react'

import { Button } from '@/lib/components/Button'
import { Status } from '@/lib/models/status'

interface Props {
  className?: string
  status: Status
  onReply?: (status: Status) => void
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
