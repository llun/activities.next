import { Pencil } from 'lucide-react'
import { FC } from 'react'

import { EditableStatus, Status, StatusType } from '@/lib/models/status'

interface Props {
  status: Status
  onEdit?: (status: EditableStatus) => void
}

export const EditButton: FC<Props> = ({ status, onEdit }) => {
  if (status.type === StatusType.enum.Announce) return null
  return (
    <button
      className="flex items-center gap-1.5 rounded-full px-2 py-1 text-sm hover:bg-muted transition-colors"
      title="Edit"
      onClick={(e) => {
        e.stopPropagation()
        onEdit?.(status)
      }}
    >
      <Pencil className="h-4 w-4" />
    </button>
  )
}
