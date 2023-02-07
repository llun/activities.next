import { FC } from 'react'

import { Button } from './Button'
import styles from './TimelineLoadMoreButton.module.scss'

interface Props {
  onClick: () => void
}

export const TimelineLoadMoreButton: FC<Props> = ({ onClick }) => {
  return (
    <div className={styles.button}>
      <Button
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
