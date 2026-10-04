'use client'

import { FC, ReactNode } from 'react'

import { useMobileNavigation } from '@/lib/components/layout/mobile-navigation-context'
import { cn } from '@/lib/utils'

import { PROFILE_CARD_MOBILE_CLASS } from './profileLayout'

interface ProfileCardSectionProps {
  className: string
  /** Extra classes that, like the full-bleed frame, apply only signed in. */
  signedInClassName?: string
  children: ReactNode
}

/**
 * The profile card's outer section, shared by the page and its skeleton.
 * Signed in — under the `(timeline)` layout's `MobileNavigationProvider` — it
 * goes full-bleed and square below `md` so the floating menu button sits over
 * the cover. Logged out (`PublicShell` provides no mobile navigation) it keeps
 * the framed card under the public top bar at every width.
 */
export const ProfileCardSection: FC<ProfileCardSectionProps> = ({
  className,
  signedInClassName,
  children
}) => {
  const isSignedIn = useMobileNavigation() !== null
  return (
    <section
      className={cn(
        className,
        isSignedIn && PROFILE_CARD_MOBILE_CLASS,
        isSignedIn && signedInClassName
      )}
    >
      {children}
    </section>
  )
}
