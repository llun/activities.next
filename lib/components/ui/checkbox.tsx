import * as React from 'react'

import { cn } from '@/lib/utils'

function Checkbox({
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        'border-input text-primary focus-visible:border-ring focus-visible:ring-ring/50 size-4 rounded border bg-transparent shadow-xs transition-[color,box-shadow] outline-none accent-current disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-[3px]',
        className
      )}
      {...props}
    />
  )
}

export { Checkbox }
