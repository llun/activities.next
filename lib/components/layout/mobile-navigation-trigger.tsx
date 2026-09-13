'use client'

import { Menu } from 'lucide-react'
import { forwardRef } from 'react'

import { useMobileNavigation } from '@/lib/components/layout/mobile-navigation-context'
import { NotificationBadge } from '@/lib/components/notification-badge/NotificationBadge'
import { DialogTrigger } from '@/lib/components/ui/dialog'
import { cn } from '@/lib/utils'

export type MobileNavigationTriggerProps =
  React.ButtonHTMLAttributes<HTMLButtonElement>

export const MobileNavigationTrigger = forwardRef<
  HTMLButtonElement,
  MobileNavigationTriggerProps
>(function MobileNavigationTrigger({ className, ...props }, ref) {
  const nav = useMobileNavigation()
  if (!nav) return null

  const { unreadCount } = nav
  const ariaLabel =
    unreadCount > 0
      ? unreadCount === 1
        ? 'Open navigation, 1 unread notification'
        : `Open navigation, ${unreadCount} unread notifications`
      : 'Open navigation'

  return (
    <DialogTrigger asChild>
      <button
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        className={cn(
          'relative flex h-11 w-11 items-center justify-center rounded-lg text-foreground hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring md:hidden',
          className
        )}
        {...props}
      >
        <Menu className="h-5 w-5" />
        {unreadCount > 0 && (
          <NotificationBadge
            count={unreadCount}
            aria-hidden="true"
            className="top-1 right-1"
          />
        )}
      </button>
    </DialogTrigger>
  )
})
