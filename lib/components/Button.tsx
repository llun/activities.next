import React, { FC, ReactNode } from 'react'
import cn from 'classnames'

interface Props {
  children: ReactNode
  type?: 'button' | 'submit'
  variant?:
    | 'primary'
    | 'secondary'
    | 'success'
    | 'danger'
    | 'warning'
    | 'info'
    | 'light'
    | 'dark'
    | 'link'
  onClick?: React.MouseEventHandler<HTMLButtonElement>
}

export const Button: FC<Props> = ({
  children,
  type = 'button',
  variant = 'primary',
  onClick
}) => {
  return (
    <button
      className={cn('btn', `btn-${variant}`)}
      type={type}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
