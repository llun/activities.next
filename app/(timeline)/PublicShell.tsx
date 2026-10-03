import { FC, ReactNode } from 'react'

import { Modal } from '@/app/Modal'
import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'
import { getBaseURL } from '@/lib/config'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'

import { PublicFooter } from './PublicFooter'
import { PublicMobileNav } from './PublicMobileNav'
import { PublicTopBar } from './PublicTopBar'

interface PublicShellProps {
  children: ReactNode
}

/**
 * Public chrome for logged-out visitors on the federated reading surfaces
 * (single status, profiles, hashtags, shared collections): a slim top bar with
 * sign-in CTAs and a footer in place of the nav sidebar, with a narrow reading
 * column that widens below `md` to stay aligned with the full-bleed mobile
 * feeds. This used to live inline in the `(timeline)` layout, but the
 * logged-out home route renders a full-bleed landing instead, so the chrome
 * moved into the sub-trees that still need it (`[actor]/*`, `tags/*`,
 * `collections/*`).
 *
 * Below `md` the top bar steps aside for the same pattern signed-in readers
 * get — each page's compact bar (or the profile's floating button) opening a
 * left drawer — but with the public drawer: Home, Sign in, and Create account
 * while registration is open.
 */
export const PublicShell: FC<PublicShellProps> = async ({ children }) => {
  const {
    registrations: { open: registrationOpen }
  } = await getResolvedServerSettings()
  // The drawer's logo on the canonical origin, as PublicTopBar builds its own.
  const logoSrc = new URL('/logo-nav.png', getBaseURL()).toString()

  return (
    <MobileNavigationProvider>
      {/* min-h-dvh (dynamic viewport height) rather than min-h-screen/100vh so
          the footer stays at the bottom without a mobile address-bar gap —
          same rationale as the public error pages
          (lib/components/error-page.tsx). */}
      <div data-shell="public" className="group/shell flex min-h-dvh flex-col">
        <PublicTopBar registrationOpen={registrationOpen} />
        <PublicMobileNav
          registrationOpen={registrationOpen}
          logoSrc={logoSrc}
        />
        <main className="flex flex-1 flex-col overflow-x-clip">
          {/* Below `md` the reading column widens to the viewport: feed
              frames span the viewport themselves, and dropping the cap keeps
              the page's other content and chrome aligned with them between
              680 and 767px. It also drops its top padding there, so each
              page's sticky compact bar (or the profile cover) starts at the
              top of the viewport. From `md` up the narrow reading column is
              unchanged. */}
          <div className="mx-auto flex w-full max-w-[680px] flex-1 flex-col px-4 py-6 max-md:max-w-none max-md:pt-0">
            {children}
          </div>
        </main>
        {/* Footer is a sibling of <main> (not nested in it) so its <footer>
            maps to the contentinfo landmark; main keeps flex-1 to pin it to
            the bottom on short pages. */}
        <PublicFooter />
        <Modal />
      </div>
    </MobileNavigationProvider>
  )
}
