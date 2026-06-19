import Image from 'next/image'
import { FC } from 'react'

import { Posts } from '@/lib/components/posts/posts'
import { getBaseURL } from '@/lib/config'
import { Status } from '@/lib/types/domain/status'

interface LandingPublicFeedProps {
  host: string
  currentTime: number
  statuses: Status[]
}

/**
 * Left column of the logged-out landing when the server has public posts: a
 * read-only preview of the server's recent public timeline. It reuses the same
 * `Posts` component the signed-in timeline uses, with `showActions={false}` and
 * no `currentActor`, so logged-out visitors see real posts without interactive
 * controls. Real interactions live behind sign-in (the right column).
 */
export const LandingPublicFeed: FC<LandingPublicFeedProps> = ({
  host,
  currentTime,
  statuses
}) => {
  // Absolute URL on the configured host (ACTIVITIES_HOST) so the logo resolves
  // against the canonical origin even when served behind a CDN on an alias
  // domain, where a root-relative `/logo-nav.png` may be redirected away.
  const logoSrc = new URL('/logo-nav.png', getBaseURL()).toString()
  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b bg-background/70 px-5 py-3.5 backdrop-blur">
        <Image
          src={logoSrc}
          alt=""
          aria-hidden="true"
          width={28}
          height={28}
          className="h-7 w-7 shrink-0 object-contain"
        />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold leading-tight">
            {host}
          </h1>
          <div className="text-xs text-muted-foreground">
            Recent posts on this server
          </div>
        </div>
      </div>

      <Posts
        framed={false}
        host={host}
        currentTime={currentTime}
        statuses={statuses}
        showActions={false}
        showReadOnlyStats
      />

      <div className="px-5 py-4 text-center text-xs text-muted-foreground">
        Sign in to see the full timeline, reply, and follow across the
        Fediverse.
      </div>
    </div>
  )
}
