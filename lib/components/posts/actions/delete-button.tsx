import { Trash2 } from 'lucide-react'
import { FC } from 'react'

import { deleteStatus } from '@/lib/client'
import { Status, StatusNote, StatusPoll } from '@/lib/models/status'

interface Props {
  status: StatusNote | StatusPoll
  onPostDeleted?: (status: Status) => void
}

export const DeleteButton: FC<Props> = ({ status, onPostDeleted }) => {
  return (
    <button
      className="flex items-center gap-1.5 rounded-full px-2 py-1 text-sm hover:bg-muted hover:text-red-500 transition-colors"
      title="Delete post"
      onClick={async (e) => {
        e.stopPropagation()
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
      <Trash2 className="h-4 w-4" />
    </button>
  )
}
