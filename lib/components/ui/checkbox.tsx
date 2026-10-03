import * as React from 'react'

import { cn } from '@/lib/utils'

// A native <input type="checkbox"> drawn as the design's checkbox: 16 px,
// radius 4, 1 px border, an orange fill and a thin white tick when checked.
//
// It stays a real checkbox (`appearance-none` only removes the platform
// paint), so a form posts it and a label's `htmlFor` toggles it exactly as with
// the unstyled control, in every browser and without JavaScript. The tick is a
// background image on the checked state rather than a child element, so call
// sites that pass a size or a margin class to the input keep working. It is
// the design's Icon/12/Check (lucide's check on a 24 grid, so a 12 px tick has
// a 1 px stroke) in the primary foreground, white in both themes, centred in
// the box; pass `bg-[length:14px_14px]` for the 14 px one.
//
// In forced-colors (high-contrast) mode the browser swaps the palette for the
// user's, so a white tick can land on a white box and a checked box would look
// unchecked (on the OAuth consent card, every scope is pre-checked). There
// `forced-colors:appearance-auto` brings the native checkbox back, which the
// system draws in its own contrasting colours. That mode also drops the
// box-shadow focus ring, so keyboard focus gets the native outline back, and
// the system already dims a disabled box, so the 50% opacity is reset there.
function Checkbox({
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        'border-input bg-popover focus-visible:border-ring focus-visible:ring-ring/50 size-4 shrink-0 appearance-none forced-colors:appearance-auto forced-colors:focus-visible:[outline-style:auto] forced-colors:disabled:opacity-100 rounded border bg-center bg-no-repeat bg-[length:12px_12px] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'checked:border-primary checked:bg-primary checked:bg-[url(data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23FFFFFF%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M20%206%209%2017l-5-5%22%2F%3E%3C%2Fsvg%3E)]',
        className
      )}
      {...props}
    />
  )
}

export { Checkbox }
