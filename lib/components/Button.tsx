import cn from 'classnames'
import React, { FC, ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
  type?: 'button' | 'submit'
  outline?: boolean
  disabled?: boolean
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
  className,
  type = 'button',
  outline,
  disabled,
  variant = 'primary',
  onClick
}) => {
  return (
    <button
      className={cn(
        'btn',
        `btn${outline ? '-outline' : ''}-${variant}`,
        className
      )}
      disabled={disabled}
      type={type}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
