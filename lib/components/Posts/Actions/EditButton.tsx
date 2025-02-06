import { FC } from 'react'

import { EditableStatus, Status, StatusType } from '@/lib/models/status'

import { Button } from '../../Button'

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
      <i className="bi bi-pencil" />
    </Button>
  )
}
