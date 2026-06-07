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
}

/**
 * Logged-out landing: a full-bleed split with the auth card on the right and,
 * on the left, either a preview of the server's public timeline (when there are
 * public posts) or a brand hero. Mirrors the design system's web-landing kit
 * (`feed.html` / `index.html`). Sits on the body's signature dual-tint gradient;
 * the auth column is translucent so the backdrop reads through.
 */
export const Landing: FC<LandingProps> = ({
  host,
  currentTime,
  statuses,
  serviceName
}) => {
  const hasPublicPosts = statuses.length > 0
  return (
    <main className="grid min-h-dvh grid-cols-1 lg:h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="min-h-0 lg:overflow-y-auto">
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
      <div className="min-h-0 bg-background/80 lg:overflow-y-auto">
        <LandingAuthPanel serviceName={serviceName} />
      </div>
    </main>
  )
}
