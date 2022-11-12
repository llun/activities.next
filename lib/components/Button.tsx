import React, { FC, ReactNode } from 'react'
import cn from 'classnames'

interface Props {
  children: ReactNode
  type:
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

export const Button: FC<Props> = ({ children, type, onClick }) => {
  return (
    <button className={cn('btn', `btn-${type}`)} onClick={onClick}>
      {children}
    </button>
  )
}
