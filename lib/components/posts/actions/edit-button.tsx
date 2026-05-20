import { Pencil } from 'lucide-react'
import { FC } from 'react'

import { EditableStatus, Status, StatusType } from '@/lib/types/domain/status'

interface Props {
  status: Status
  onEdit?: (status: EditableStatus) => void
}

export const EditButton: FC<Props> = ({ status, onEdit }) => {
  if (status.type === StatusType.enum.Announce) return null
  return (
    <button
      className="flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-sm transition-colors hover:bg-muted"
      title="Edit"
      aria-label="Edit post"
      onClick={(e) => {
        e.stopPropagation()
        onEdit?.(status)
      }}
    >
      <Pencil className="h-4 w-4" />
    </button>
  )
}
