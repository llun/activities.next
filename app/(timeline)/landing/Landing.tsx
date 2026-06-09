import { FC } from 'react'

import { Status } from '@/lib/types/domain/status'

import { LandingAuthPanel } from './LandingAuthPanel'
import { LandingHero } from './LandingHero'
import { LandingPublicFeed } from './LandingPublicFeed'

interface LandingProps {
  host: string
  currentTime: number
  /** Recent public statuses to preview. Empty → the brand hero is shown. */
  statuses: Status[]
  serviceName: string
  /**
   * Whether the server is accepting new account sign-ups. When `false`, the
   * auth card drops the "Create account" path for a sign-in-only "registration
   * closed" notice. Defaults to open.
   */
  signupOpen?: boolean
}

/**
 * Logged-out landing: a full-bleed split with the auth card on the right and,
 * on the left, either a preview of the server's public timeline (when there are
 * public posts) or a brand hero. Mirrors the design system's web-landing kit
 * (`feed.html` / `index.html`, plus the `*-registration-closed.html` variants).
 * Sits on the body's signature dual-tint gradient; the auth column is
 * translucent so the backdrop reads through.
 */
export const Landing: FC<LandingProps> = ({
  host,
  currentTime,
  statuses,
  serviceName,
  signupOpen = true
}) => {
  const hasPublicPosts = statuses.length > 0
  return (
    <main className="grid min-h-dvh grid-cols-1 md:h-dvh md:grid-cols-[1.1fr_1fr]">
      <div className="flex min-h-0 flex-col md:overflow-y-auto">
        {hasPublicPosts ? (
          <LandingPublicFeed
            host={host}
            currentTime={currentTime}
            statuses={statuses}
          />
        ) : (
          <LandingHero serviceName={serviceName} />
        )}
      </div>
      <div className="flex min-h-0 flex-col bg-background/80 md:overflow-y-auto">
        <LandingAuthPanel serviceName={serviceName} signupOpen={signupOpen} />
      </div>
    </main>
  )
}
