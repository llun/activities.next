import { FC } from 'react'

import { StatusData } from '../../../models/status'
import { Button } from '../../Button'

interface Props {
  className?: string
  status: StatusData
  onEdit?: (status: StatusData) => void
}

export const EditButton: FC<Props> = ({ className, status, onEdit }) => {
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
