import { FC } from 'react'

import { Button } from '../../Button'

export const EditButton: FC = () => {
  return (
    <Button variant="link" title="Edit">
      <i className="bi bi-pencil" />
    </Button>
  )
}
