import cn from 'classnames'
import React, { FC } from 'react'

interface Props {
  label?: string
  className?: string
  variant?: 'default' | 'white'
  onClick?: React.MouseEventHandler<HTMLButtonElement>
}

export const CloseButton: FC<Props> = ({
  label = 'Close',
  className,
  variant = 'primary',
  onClick
}) => {
  return (
    <button
      className={cn('btn-close', className, {
        'btn-close-white': variant === 'white'
      })}
      type="button"
      aria-label={label}
      onClick={onClick}
    />
  )
}
