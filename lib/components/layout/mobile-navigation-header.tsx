'use client'

import { Logo } from '@/lib/components/layout/logo'
import { useMobileNavigation } from '@/lib/components/layout/mobile-navigation-context'
import { MobileNavigationTrigger } from '@/lib/components/layout/mobile-navigation-trigger'
import { cn } from '@/lib/utils'

export interface MobileNavigationHeaderProps {
  className?: string
}

export function MobileNavigationHeader({
  className
}: MobileNavigationHeaderProps) {
  const nav = useMobileNavigation()
  if (!nav) return null

  return (
    <div
      className={cn(
        'sticky top-0 z-30 -mx-4 -mt-6 mb-4 flex items-center gap-3 border-b bg-background/90 px-4 py-2 backdrop-blur md:hidden',
        className
      )}
    >
      <MobileNavigationTrigger />
      <Logo size="sm" />
    </div>
  )
}
