import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-(--control-h) w-full min-w-0 rounded-md border bg-background px-3 py-1 text-base shadow-[inset_0_1px_0_hsl(0_0%_0%/0.04)] transition-[color,box-shadow] outline-none appearance-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:bg-muted dark:disabled:bg-input/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:outline-none focus-visible:border-ring focus-visible:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--ring)] forced-colors:focus-visible:[outline-style:solid] forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-[CanvasText]',
        // The invalid ring is drawn at rest, not only on focus: the width sits
        // on `aria-invalid` too. On focus it gives way to the two-tone ring in
        // --destructive-text (the readable red in both themes; the dark
        // --destructive fill is under 2:1 on the page), since a ring shadow
        // paints over the focus shadow.
        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:focus-visible:ring-0 aria-invalid:focus-visible:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--destructive-text)]',
        className
      )}
      {...props}
    />
  )
}

export { Input }
