import React, { FC, ReactNode } from 'react'
import cn from 'classnames'

interface Props {
  children: ReactNode
  type?: 'button' | 'submit'
  outline?: boolean
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
  outline,
  variant = 'primary',
  onClick
}) => {
  return (
    <button
      className={cn('btn', `btn${outline ? '-outline' : ''}-${variant}`)}
      type={type}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
