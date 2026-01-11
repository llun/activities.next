import { FC } from 'react'

import { cn } from '@/lib/utils'

interface Props {
  count: number
  className?: string
}

export const NotificationBadge: FC<Props> = ({ count, className }) => {
  if (count <= 0) return null

  const displayCount = count > 99 ? '99+' : count.toString()

  return (
    <span
      className={cn(
        'absolute -top-1 -right-1 flex items-center justify-center',
        'min-w-[18px] h-[18px] px-1 rounded-full',
        'bg-destructive text-white',
        'text-xs font-medium',
        className
      )}
    >
      {displayCount}
    </span>
  )
}
