import { FC } from 'react'

import { Button } from '../../Button'

interface Props {
  className?: string
}

export const EditButton: FC<Props> = ({ className }) => {
  return (
    <Button className={className} variant="link" title="Edit">
      <i className="bi bi-pencil" />
    </Button>
  )
}
