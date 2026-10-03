'use client'

import { Menu } from 'lucide-react'
import { forwardRef } from 'react'

import { useMobileNavigation } from '@/lib/components/layout/mobile-navigation-context'
import { DialogTrigger } from '@/lib/components/ui/dialog'
import { cn } from '@/lib/utils'

export type MobileNavigationTriggerProps =
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    /**
     * `bar` sits at the start of the compact page bar. `floating` is the
     * profile page's circular button, fixed over the cover at the top-left
     * inset: it has no bar behind it, so it carries its own solid,
     * theme-aware surface, hairline border and shadow to stay legible over a
     * bright or dark cover and over the feed once the cover scrolls away.
     */
    variant?: 'bar' | 'floating'
  }

const VARIANT_CLASS = {
  bar: 'relative flex h-11 w-11 items-center justify-center rounded-lg text-foreground hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
  floating:
    'fixed top-[calc(env(safe-area-inset-top,0px)+16px)] left-[calc(env(safe-area-inset-left,0px)+16px)] z-30 flex size-11 items-center justify-center rounded-full border bg-popover text-popover-foreground shadow-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-foreground'
} as const

/**
 * Opens the mobile navigation drawer. Both variants are the same Radix
 * `DialogTrigger` under the one `MobileNavigationProvider`, so they open the
 * same drawer and focus returns to whichever one opened it.
 *
 * The button carries no unread count: counts live on the drawer's own rows,
 * so its accessible name is always "Open navigation".
 */
export const MobileNavigationTrigger = forwardRef<
  HTMLButtonElement,
  MobileNavigationTriggerProps
>(function MobileNavigationTrigger(
  { className, variant = 'bar', ...props },
  ref
) {
  const nav = useMobileNavigation()
  if (!nav) return null

  return (
    <DialogTrigger asChild>
      <button
        ref={ref}
        type="button"
        aria-label="Open navigation"
        data-floating-nav-trigger={variant === 'floating' ? '' : undefined}
        className={cn(VARIANT_CLASS[variant], 'md:hidden', className)}
        {...props}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>
    </DialogTrigger>
  )
})
