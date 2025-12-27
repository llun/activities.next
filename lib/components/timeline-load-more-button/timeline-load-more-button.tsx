import { FC } from 'react'

import { Button } from '../ui/button'

interface Props {
  disabled?: boolean
  onClick: () => void
}

export const TimelineLoadMoreButton: FC<Props> = ({ disabled, onClick }) => {
  return (
    <div className="p-4 flex cursor-pointer font-bold items-center justify-center">
      <Button
        disabled={disabled}
        variant="link"
        onClick={(event) => {
          event.preventDefault()
          onClick?.()
        }}
      >
        Load More Timeline
      </Button>
    </div>
  )
}
