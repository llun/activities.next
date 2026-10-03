import * as React from 'react'

import { cn } from '@/lib/utils'

// The closed control of a native <select> as the design draws it: the OS arrow
// is hidden (`appearance-none`) and a thin 14 px chevron, in the muted
// foreground, is painted at the right edge instead. Only the closed control
// changes: the open menu is still the platform's own list, and the element
// stays a real <select> (keyboard, form posting and mobile pickers unchanged).
//
// The chevron is a background image rather than an icon element so `Select`
// stays a bare <select> with nothing wrapped around it. A data URI cannot read
// a CSS variable, so the stroke repeats the two --muted-foreground values:
// #6E6E6E in light, #A3A3A3 in dark. `pr-8` keeps the text clear of it.
//
// Private to this file on purpose: every native select in the app is `Select`,
// so a call site that needs its own width passes a `className` to it rather
// than appending the chevron to a raw <select> (`formControlUsage.test.ts` fails on
// a raw one).
const selectChevronClassName = cn(
  'appearance-none bg-[length:14px_14px] bg-[position:right_0.75rem_center] bg-no-repeat pr-8',
  'bg-[url(data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236E6E6E%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E)]',
  'dark:bg-[url(data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23A3A3A3%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E)]'
)

function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
        // Last, so a call site's `px-*` cannot drop the room the chevron needs.
        selectChevronClassName
      )}
      {...props}
    />
  )
}

export { Select }
