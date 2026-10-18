import Link from 'next/link'

import { Logo } from '@/lib/components/layout/logo'
import { Button } from '@/lib/components/ui/button'
import { getDatabase } from '@/lib/database'
import { getVisitedSignUpDomain } from '@/lib/services/domains/visitedSignUpDomain'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { getBrandAssetSrc } from '@/lib/utils/getBrandAssetSrc'

// Public top bar shown to logged-out visitors in place of the app nav sidebar:
// a slim sticky bar with the brand logo and Sign in / Create account links to
// the real auth routes, matching the web-public design. The "Create account"
// CTA is hidden when sign-ups on the visited domain are closed.
export const PublicTopBar = async () => {
  // Sign-ups of the domain this page is visited on: a domain whose sign-ups
  // are closed hides the link even when the primary's are open. Without a
  // database there are no domain rows, so the primary's settings answer.
  const database = getDatabase()
  const registrationOpen = database
    ? (await getVisitedSignUpDomain(database)).open
    : (await getResolvedServerSettings()).registrations.open
  // Absolute logo URL on the canonical origin (ACTIVITIES_HOST) so it resolves
  // even when this page is served on a CDN alias domain, matching PublicFooter.
  // In `next dev` it stays root-relative so it loads from the browser's origin.
  const logoSrc = getBrandAssetSrc('/logo-nav.png')
  return (
    <header
      data-public-top-bar=""
      className="sticky top-0 z-30 border-b bg-surface-chrome backdrop-blur"
    >
      {/* Full width below `md` to stay aligned with PublicShell's content
          column, which drops the same 680px cap while mobile feeds span the
          viewport. From `md` up both keep the narrow reading width. */}
      <div className="mx-auto flex h-16 w-full max-w-[680px] items-center gap-3 px-4 max-md:max-w-none">
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
