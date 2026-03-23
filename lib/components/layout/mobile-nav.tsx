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
      <ul className="flex items-center justify-around py-2">
        {allNavItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + '/')
          const isNotifications = item.href === '/notifications'
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  'flex flex-col items-center gap-1 px-4 py-2 text-xs font-medium transition-colors relative',
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
                <span>{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
