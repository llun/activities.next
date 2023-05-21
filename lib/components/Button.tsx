import cn from 'classnames'
import React, { FC, ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
  type?: 'button' | 'submit'
  outline?: boolean
  disabled?: boolean
  title?: string
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
  title,
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
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
