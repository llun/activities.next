'use client'

import { Bell, Home, Settings } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  ActorInfo,
  ActorSwitcher
} from '@/lib/components/actor-switcher/ActorSwitcher'
import { Logo } from '@/lib/components/layout/logo'
import { NotificationBadge } from '@/lib/components/notification-badge/NotificationBadge'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/lib/components/ui/tooltip'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/', label: 'Timeline', icon: Home },
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/settings', label: 'Settings', icon: Settings }
]

interface User {
  name: string
  username: string
  handle: string
  avatarUrl?: string
}

interface SidebarProps {
  user?: User
  currentActor?: ActorInfo
  actors?: ActorInfo[]
  unreadCount?: number
}

export function Sidebar({
  user,
  currentActor,
  actors = [],
  unreadCount = 0
}: SidebarProps) {
  const pathname = usePathname()

  const getAvatarInitial = (username: string) => {
    if (!username) return '?'
    return username[0].toUpperCase()
  }

  return (
    <TooltipProvider delayDuration={0}>
      {/* Full sidebar - Desktop */}
      <aside className="fixed left-0 top-0 z-40 h-screen w-[280px] border-r bg-background/90 backdrop-blur hidden xl:flex flex-col">
        <div className="p-6">
          <Logo size="md" />
        </div>

        <nav className="flex-1 px-3">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + '/')
              const isNotifications = item.href === '/notifications'
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors relative',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <item.icon className="h-5 w-5" />
                    {item.label}
                    {isNotifications && unreadCount > 0 && (
                      <NotificationBadge
                        count={unreadCount}
                        className="static ml-1"
                      />
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        {currentActor && actors.length > 0 ? (
          <div className="border-t p-4">
            <ActorSwitcher currentActor={currentActor} actors={actors} />
          </div>
        ) : (
          user && (
            <div className="border-t p-4">
              <Link
                href={`/${user.handle}`}
                className="flex items-center gap-3 rounded-lg p-2 cursor-pointer hover:bg-muted transition-colors"
              >
                <Avatar className="h-10 w-10">
                  {user.avatarUrl && <AvatarImage src={user.avatarUrl} />}
                  <AvatarFallback className="bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    {getAvatarInitial(user.username)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 overflow-hidden">
                  <p className="text-sm font-medium truncate">{user.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {user.handle}
                  </p>
                </div>
              </Link>
            </div>
          )
        )}
      </aside>

      {/* Collapsed sidebar - Tablet */}
      <aside className="fixed left-0 top-0 z-40 h-screen w-[72px] border-r bg-background/90 backdrop-blur hidden md:flex xl:hidden flex-col items-center">
        <div className="p-4">
          <Logo showText={false} size="md" />
        </div>

        <nav className="flex-1 py-4">
          <ul className="space-y-2">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + '/')
              const isNotifications = item.href === '/notifications'
              return (
                <li key={item.href}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        href={item.href}
                        className={cn(
                          'flex items-center justify-center rounded-lg p-3 transition-colors relative',
                          isActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        <item.icon className="h-6 w-6" />
                        {isNotifications && unreadCount > 0 && (
                          <NotificationBadge
                            count={unreadCount}
                            className="absolute -top-1 -right-1"
                          />
                        )}
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                </li>
              )
            })}
          </ul>
        </nav>

        {user && (
          <div className="border-t p-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href={`/${user.handle}`} className="cursor-pointer block">
                  <Avatar className="h-10 w-10">
                    {user.avatarUrl && <AvatarImage src={user.avatarUrl} />}
                    <AvatarFallback className="bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                      {getAvatarInitial(user.username)}
                    </AvatarFallback>
                  </Avatar>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{user.handle}</TooltipContent>
            </Tooltip>
          </div>
        )}
      </aside>
    </TooltipProvider>
  )
}
