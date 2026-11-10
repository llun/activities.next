import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-input placeholder:text-muted-foreground aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive aria-invalid:focus-visible:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--destructive)] aria-invalid:ring-[3px] dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-background px-3 py-2 text-base shadow-[inset_0_1px_0_hsl(0_0%_0%/0.04)] transition-[color,box-shadow] outline-none focus-visible:outline-none focus-visible:border-ring focus-visible:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--ring)] forced-colors:focus-visible:[outline-style:solid] forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-[CanvasText] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
