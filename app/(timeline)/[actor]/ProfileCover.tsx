'use client'

import { FC, ReactNode } from 'react'

import { useMobileNavigation } from '@/lib/components/layout/mobile-navigation-context'
import { cn } from '@/lib/utils'

import { PROFILE_COVER_MOBILE_CLASS } from './profileLayout'

interface ProfileCoverProps {
  className?: string
  children: ReactNode
}

/**
 * The profile's cover image box, shared by the page and its skeleton. Signed in
 * — under the `(timeline)` layout's `MobileNavigationProvider` — it goes
 * full-bleed and square below `md` so the cover meets the top and both edges of
 * the viewport and the floating menu button sits over it. Logged out
 * (`PublicShell` provides no mobile navigation) it keeps its rounded corners
 * under the public top bar at every width.
 */
export const ProfileCover: FC<ProfileCoverProps> = ({
  className,
  children
}) => {
  const isSignedIn = useMobileNavigation() !== null
  return (
    <div
      data-slot="profile-cover"
      className={cn(
        'overflow-hidden rounded-lg',
        isSignedIn && PROFILE_COVER_MOBILE_CLASS,
        className
      )}
    >
      {children}
    </div>
  )
}
