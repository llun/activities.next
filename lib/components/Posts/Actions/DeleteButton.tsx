import { FC } from 'react'

import { deleteStatus } from '@/lib/client'
import { Status, StatusNote, StatusPoll } from '@/lib/models/status'

import { Button } from '../../Button'

interface Props {
  className?: string
  status: StatusNote | StatusPoll
  onPostDeleted?: (status: Status) => void
}

export const DeleteButton: FC<Props> = ({
  className,
  status,
  onPostDeleted
}) => {
  return (
    <Button
      className={className}
      variant="link"
      title="Delete post"
      onClick={async () => {
        const deleteConfirmation = window.confirm(
          `Confirm delete status! ${
            status.text.length ? `${status.text.slice(0, 20)}...` : status.id
          }`
        )
        if (!deleteConfirmation) return
        await deleteStatus({ statusId: status.id })
        onPostDeleted?.(status)
      }}
    >
      <i className="bi bi-trash3" />
    </Button>
  )
}
