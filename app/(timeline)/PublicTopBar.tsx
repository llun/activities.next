import Link from 'next/link'

import { Logo } from '@/lib/components/layout/logo'
import { Button } from '@/lib/components/ui/button'
import { getBaseURL } from '@/lib/config'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'

// Public top bar shown to logged-out visitors in place of the app nav sidebar:
// a slim sticky bar with the brand logo and Sign in / Create account links to
// the real auth routes, matching the web-public design. The "Create account"
// CTA is hidden when the server has closed registration.
export const PublicTopBar = async () => {
  const {
    registrations: { open: registrationOpen }
  } = await getResolvedServerSettings()
  // Absolute logo URL on the canonical origin (ACTIVITIES_HOST) so it resolves
  // even when this page is served on a CDN alias domain, matching PublicFooter.
  const logoSrc = new URL('/logo-nav.png', getBaseURL()).toString()
  return (
    <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-[680px] items-center gap-3 px-4">
        <Logo size="md" src={logoSrc} />
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/auth/signin">Sign in</Link>
          </Button>
          {registrationOpen && (
            <Button asChild size="sm">
              <Link href="/auth/signup">Create account</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
