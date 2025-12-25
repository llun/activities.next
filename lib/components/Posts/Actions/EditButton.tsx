import { Pencil } from 'lucide-react'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import { EditableStatus, Status, StatusType } from '@/lib/models/status'

interface Props {
  className?: string
  status: Status
  onEdit?: (status: EditableStatus) => void
}

export const EditButton: FC<Props> = ({ className, status, onEdit }) => {
  if (status.type === StatusType.enum.Announce) return null
  return (
    <Button
      className={className}
      variant="link"
      title="Edit"
      onClick={() => onEdit?.(status)}
    >
      <Pencil className="size-4" />
    </Button>
  )
}
