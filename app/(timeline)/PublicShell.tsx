import { FC, ReactNode } from 'react'

import { Modal } from '@/app/Modal'

import { PublicFooter } from './PublicFooter'
import { PublicTopBar } from './PublicTopBar'

interface PublicShellProps {
  children: ReactNode
}

/**
 * Public chrome for logged-out visitors on the federated reading surfaces
 * (single status, profiles, hashtags): a slim top bar with sign-in CTAs and a
 * footer in place of the nav sidebar, with a narrow reading column. This used
 * to live inline in the `(timeline)` layout, but the logged-out home route
 * renders a full-bleed landing instead, so the chrome moved into the sub-trees
 * that still need it (`[actor]/*`, `tags/*`).
 */
export const PublicShell: FC<PublicShellProps> = ({ children }) => (
  // min-h-dvh (dynamic viewport height) rather than min-h-screen/100vh so the
  // footer stays at the bottom without a mobile address-bar gap — same
  // rationale as the public error pages (lib/components/error-page.tsx).
  <div className="flex min-h-dvh flex-col">
    <PublicTopBar />
    <main className="flex flex-1 flex-col overflow-x-clip">
      <div className="mx-auto flex w-full max-w-[680px] flex-1 flex-col px-4 py-6">
        {children}
      </div>
    </main>
    {/* Footer is a sibling of <main> (not nested in it) so its <footer> maps to
        the contentinfo landmark; main keeps flex-1 to pin it to the bottom on
        short pages. */}
    <PublicFooter />
    <Modal />
  </div>
)
