import { FC } from 'react'

import { Logo } from '@/lib/components/layout/logo'
import { getBaseURL } from '@/lib/config'

import { PublicAuthActions } from './PublicAuthActions'

// Public top bar shown to logged-out visitors in place of the app nav sidebar:
// a slim sticky bar with the brand logo and Sign in / Create account links to
// the real auth routes, matching the web-public design. The "Create account"
// CTA is hidden when the server has closed registration. Below `md` the bar is
// hidden: each page's compact bar opens the public drawer instead, which
// carries the same CTAs (`PublicShell`).
export const PublicTopBar: FC<{ registrationOpen: boolean }> = ({
  registrationOpen
}) => {
  // Absolute logo URL on the canonical origin (ACTIVITIES_HOST) so it resolves
  // even when this page is served on a CDN alias domain, matching PublicFooter.
  const logoSrc = new URL('/logo-nav.png', getBaseURL()).toString()
  return (
    <header className="sticky top-0 z-30 border-b bg-surface-chrome backdrop-blur max-md:hidden">
      {/* The same narrow reading width as PublicShell's content column. */}
      <div className="mx-auto flex h-16 w-full max-w-[680px] items-center gap-3 px-4">
        <Logo size="md" src={logoSrc} />
        <PublicAuthActions
          registrationOpen={registrationOpen}
          className="ml-auto"
        />
      </div>
    </header>
  )
}
