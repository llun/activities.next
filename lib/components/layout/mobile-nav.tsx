'use client'

import { MoreHorizontal } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { buildNavItems } from '@/lib/components/layout/nav-items'
import { NotificationBadge } from '@/lib/components/notification-badge/NotificationBadge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
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
  const hasOverflow = allNavItems.length > 5
  const directNavItems = hasOverflow ? allNavItems.slice(0, 4) : allNavItems
  const overflowNavItems = hasOverflow ? allNavItems.slice(4) : []
  const isItemActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/')
  const isOverflowActive = overflowNavItems.some((item) =>
    isItemActive(item.href)
  )

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/90 backdrop-blur md:hidden safe-area-pb">
      <ul className="grid grid-flow-col auto-cols-fr items-center py-2">
        {directNavItems.map((item) => {
          const isActive = isItemActive(item.href)
          const isNotifications = item.href === '/notifications'
          return (
            <li key={item.href} className="min-w-0">
              <Link
                href={item.href}
                className={cn(
                  'relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 px-2 py-2 text-xs font-medium transition-colors',
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
        {overflowNavItems.length > 0 && (
          <li className="min-w-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'relative flex min-h-14 w-full min-w-0 flex-col items-center justify-center gap-1 px-2 py-2 text-xs font-medium transition-colors',
                    isOverflowActive ? 'text-primary' : 'text-muted-foreground'
                  )}
                  aria-label="More navigation"
                >
                  <MoreHorizontal className="h-6 w-6" />
                  <span className="max-w-full truncate">More</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="end" sideOffset={8}>
                {overflowNavItems.map((item) => {
                  const isActive = isItemActive(item.href)
                  return (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link
                        href={item.href}
                        className={cn(
                          'flex items-center gap-2',
                          isActive && 'text-primary'
                        )}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        )}
      </ul>
    </nav>
  )
}
