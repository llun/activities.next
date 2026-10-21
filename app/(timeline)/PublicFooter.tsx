import Image from 'next/image'
import Link from 'next/link'

import { getVisitedDomainIdentity } from '@/lib/services/domains/domainIdentity'
import { getBrandAssetSrc } from '@/lib/utils/getBrandAssetSrc'

// Public footer shown to logged-out visitors, matching the web-public design:
// a single bordered card with the brand line, the visited domain's terms of
// service and privacy policy (each only when it has one) and a link to the
// project source. There is no About page.
export const PublicFooter = async () => {
  const identity = await getVisitedDomainIdentity()
  // Absolute URL on the configured host (ACTIVITIES_HOST) so the logo resolves
  // against the canonical origin even when served behind a CDN on an alias
  // domain, where a root-relative `/logo-nav.png` may be redirected away. In
  // `next dev` it stays root-relative so it loads from the browser's origin.
  const logoSrc = getBrandAssetSrc('/logo-nav.png')
  return (
    // Matches PublicShell/PublicTopBar: full width below `md`, narrow from `md`.
    <footer className="mx-auto w-full max-w-[680px] px-4 py-8 max-md:max-w-none">
      <div className="rounded-xl border bg-background/70 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Image
              src={logoSrc}
              alt=""
              aria-hidden="true"
              width={20}
              height={20}
              className="h-5 w-5 shrink-0 object-contain"
            />
            <span>
              <strong className="font-semibold text-foreground">
                Activities
              </strong>{' '}
              — a self-hosted social + fitness server on the Fediverse.
            </span>
          </div>
          <nav
            aria-label="Footer"
            className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1"
          >
            {identity.termsOfService ? (
              <Link href="/terms-of-service" className="hover:text-foreground">
                Terms
              </Link>
            ) : null}
            {identity.privacyPolicy ? (
              <Link href="/privacy-policy" className="hover:text-foreground">
                Privacy
              </Link>
            ) : null}
            <a
              href="https://github.com/llun/activities.next"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground"
            >
              Source
            </a>
          </nav>
        </div>
      </div>
    </footer>
  )
}
