'use client'

import { Home } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FC } from 'react'

import { Logo } from '@/lib/components/layout/logo'
import { MobileNavigationDrawer } from '@/lib/components/layout/mobile-navigation-drawer'
import { cn } from '@/lib/utils'

import { PublicAuthActions } from './PublicAuthActions'

export interface PublicMobileNavProps {
  registrationOpen: boolean
  /**
   * Absolute logo URL on the canonical origin, built by the server caller from
   * `getBaseURL()` like `PublicTopBar` and `PublicFooter`: on a CDN alias
   * domain the root-relative default is redirected away, and below `md` this
   * drawer carries the page's only logo. Required so a new caller cannot fall
   * back to that default by omission.
   */
  logoSrc: string
  signinHref?: string
  signupHref?: string
}

/**
 * The logged-out mobile drawer, opened by the same compact-bar / floating
 * menu button as the signed-in one. It lists only what a visitor without a
 * session can actually open — Home — plus the existing Sign in / Create
 * account pair (Create account only while registration is open). It never
 * renders the nav registry: every registry destination needs an account.
 */
export const PublicMobileNav: FC<PublicMobileNavProps> = ({
  registrationOpen,
  logoSrc,
  signinHref,
  signupHref
}) => {
  const pathname = usePathname()
  const isHome = pathname === '/'

  return (
    <MobileNavigationDrawer description="Public site navigation">
      {(onNavigate) => (
        <div className="flex h-full min-h-0 flex-col bg-background">
          <div className="flex p-6 pr-14">
            <Logo size="md" src={logoSrc} onNavigate={onNavigate} />
          </div>
          <nav aria-label="Public navigation" className="px-3 pt-1">
            <ul className="space-y-1">
              <li>
                <Link
                  href="/"
                  onClick={onNavigate}
                  aria-current={isHome ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isHome
                      ? 'bg-primary/10 text-primary-text'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Home
                    className={cn('size-5', isHome && 'text-primary')}
                    aria-hidden="true"
                  />
                  Home
                </Link>
              </li>
            </ul>
          </nav>
          <PublicAuthActions
            layout="stacked"
            registrationOpen={registrationOpen}
            signinHref={signinHref}
            signupHref={signupHref}
            onNavigate={onNavigate}
            className="mt-auto border-t p-4"
          />
        </div>
      )}
    </MobileNavigationDrawer>
  )
}
