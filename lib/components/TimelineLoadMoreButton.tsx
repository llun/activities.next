import { FC } from 'react'

import { Button } from './Button'
import styles from './TimelineLoadMoreButton.module.scss'

interface Props {
  disabled?: boolean
  onClick: () => void
}

export const TimelineLoadMoreButton: FC<Props> = ({ disabled, onClick }) => {
  return (
    <div className={styles.button}>
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
