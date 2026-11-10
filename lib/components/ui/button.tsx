import { Slot } from '@radix-ui/react-slot'
import { type VariantProps, cva } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

// The keycap's bottom edge is drawn with the width in --edge-w (2px, 1px while
// pressed), so pressing changes a variable instead of the shadow: a call site
// that passes its own shadow-* keeps it while the button is pressed. The press
// skips aria-disabled buttons, which `:disabled` does not match.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:outline-none focus-visible:border-ring focus-visible:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--ring)] forced-colors:focus-visible:[outline-style:solid] forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-[CanvasText] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground border border-primary-edge shadow-[inset_0_calc(var(--edge-w,2px)*-1)_0_var(--primary-edge)] hover:bg-primary/90 active:not-disabled:not-aria-disabled:translate-y-px active:not-disabled:not-aria-disabled:[--edge-w:1px]',
        destructive:
          'bg-destructive text-white border border-destructive-edge shadow-[inset_0_calc(var(--edge-w,2px)*-1)_0_var(--destructive-edge)] hover:bg-destructive/90 dark:bg-destructive/60 active:not-disabled:not-aria-disabled:translate-y-px active:not-disabled:not-aria-disabled:[--edge-w:1px]',
        outline:
          'bg-card border border-input shadow-[inset_0_calc(var(--edge-w,2px)*-1)_0_var(--control-edge)] hover:bg-accent hover:text-accent-foreground active:not-disabled:not-aria-disabled:translate-y-px active:not-disabled:not-aria-disabled:[--edge-w:1px]',
        secondary:
          'bg-card border border-input shadow-[inset_0_calc(var(--edge-w,2px)*-1)_0_var(--control-edge)] text-secondary-foreground hover:bg-accent hover:text-accent-foreground active:not-disabled:not-aria-disabled:translate-y-px active:not-disabled:not-aria-disabled:[--edge-w:1px]',
        ghost:
          'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary-text underline-offset-4 hover:underline',
        pill: 'rounded-md bg-card border border-input shadow-[inset_0_calc(var(--edge-w,2px)*-1)_0_var(--control-edge)] hover:bg-accent hover:text-accent-foreground active:not-disabled:not-aria-disabled:translate-y-px active:not-disabled:not-aria-disabled:[--edge-w:1px]'
      },
      size: {
        default: 'h-(--control-h) px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-10'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
