'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { buildNavItems } from '@/lib/components/layout/nav-items'
import { NotificationBadge } from '@/lib/components/notification-badge/NotificationBadge'
import { cn } from '@/lib/utils'

interface MobileNavProps {
  unreadCount?: number
  fitnessUrl?: string
  isAdmin?: boolean
}

export function MobileNav({
  unreadCount = 0,
  fitnessUrl,
  isAdmin = false
}: MobileNavProps) {
  const pathname = usePathname()
  const allNavItems = buildNavItems({ fitnessUrl, isAdmin })

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/90 backdrop-blur md:hidden safe-area-pb">
      <ul className="grid grid-flow-col auto-cols-fr items-center py-2">
        {allNavItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + '/')
          const isNotifications = item.href === '/notifications'
          return (
            <li key={item.href} className="min-w-0">
              <Link
                href={item.href}
                className={cn(
                  'relative flex min-w-0 flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <div className="relative">
                  <item.icon
                    className={cn('h-6 w-6', isActive && 'fill-primary')}
                  />
                  {isNotifications && unreadCount > 0 && (
                    <NotificationBadge
                      count={unreadCount}
                      className="absolute -top-1 -right-1"
                    />
                  )}
                </div>
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
