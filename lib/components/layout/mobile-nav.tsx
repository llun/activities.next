'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { ActorInfo } from '@/lib/components/actor-switcher/ActorSwitcher'
import { useMobileNavigation } from '@/lib/components/layout/mobile-navigation-context'
import { Sidebar, UserList } from '@/lib/components/layout/sidebar'
import {
  DialogClose,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { type NavFeatureFlags } from '@/lib/services/navigation/navPreferences'
import { cn } from '@/lib/utils'

export interface MobileNavProps {
  user?: {
    handle: string
    name: string
    username: string
    avatarUrl?: string
  } | null
  currentActor?: ActorInfo | null
  actors?: ActorInfo[]
  unreadCount?: number
  fitnessUrl?: string
  isAdmin?: boolean
  lists?: UserList[]
  features?: Partial<NavFeatureFlags>
}

export function MobileNav({
  user,
  currentActor,
  actors,
  unreadCount,
  fitnessUrl,
  isAdmin = false,
  lists,
  features
}: MobileNavProps) {
  const nav = useMobileNavigation()
  const pathname = usePathname()
  const navigatedRef = useRef(false)
  const initialPathnameRef = useRef(pathname)

  const isOpen = nav?.isOpen ?? false
  const setOpen = nav?.setOpen

  useEffect(() => {
    if (isOpen) {
      navigatedRef.current = false
      initialPathnameRef.current = pathname
    }
  }, [isOpen, pathname])

  if (!nav) return null

  const effectiveUnreadCount = unreadCount ?? nav.unreadCount ?? 0

  const handleNavigate = () => {
    navigatedRef.current = true
    setOpen?.(false)
  }

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        onCloseAutoFocus={(event) => {
          // If viewport was resized to tablet/desktop (>= 768px) or a navigation occurred,
          // prevent restoring focus to the mobile hamburger trigger (which is hidden/unmounted).
          const isDesktop =
            typeof window !== 'undefined' &&
            window.matchMedia?.('(min-width: 768px)').matches
          const hasNavigated =
            navigatedRef.current || pathname !== initialPathnameRef.current
          if (isDesktop || hasNavigated) {
            event.preventDefault()
          }
        }}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-dvh max-h-dvh flex-col bg-background shadow-xl outline-none duration-200',
          'w-[min(320px,calc(100vw-48px))] safe-area-pt safe-area-pb safe-area-pl',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left'
        )}
      >
        <DialogTitle className="sr-only">Navigation drawer</DialogTitle>
        <DialogDescription className="sr-only">
          Main site navigation
        </DialogDescription>
        <DialogClose
          aria-label="Close navigation"
          className="absolute top-[calc(env(safe-area-inset-top,0px)+1rem)] right-4 z-50 flex h-11 w-11 items-center justify-center rounded-lg text-foreground hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-5 w-5" />
        </DialogClose>
        <Sidebar
          variant="drawer"
          user={user}
          currentActor={currentActor}
          actors={actors}
          unreadCount={effectiveUnreadCount}
          fitnessUrl={fitnessUrl}
          isAdmin={isAdmin}
          lists={lists}
          features={features}
          onNavigate={handleNavigate}
        />
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}
