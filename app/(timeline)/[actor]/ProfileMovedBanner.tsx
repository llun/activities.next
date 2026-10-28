import { ArrowRight, ArrowRightLeft } from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'

interface Props {
  /**
   * The new account's handle, resolved on the server from the stored actor.
   * Null when the moved-to actor is not stored any more: the banner then
   * only says the profile moved, without a way in.
   */
  acct: string | null
  /** Where "Go to new profile" leads: a local profile path or a remote URL. */
  href: string | null
  /** A remote target opens in a new tab; a local one is a soft link. */
  external: boolean
  /** The profile's owner also gets the "Manage" way into /settings/moving. */
  isOwner: boolean
  /** The owner of a redirect is told their followers have not been moved. */
  isRedirect: boolean
}

/**
 * The banner on a profile that has moved: an info Alert above the profile
 * header pointing at the new account, with the owner's way to manage the
 * move. The target is resolved on the server from the stored actor only,
 * never fetched; a movedTo pointer whose actor row is gone still draws the
 * banner, without the link.
 */
export const ProfileMovedBanner: FC<Props> = ({
  acct,
  href,
  external,
  isOwner,
  isRedirect
}) => (
  <Alert
    tone="info"
    live={false}
    title={
      acct ? (
        <>
          This profile has moved to <strong>@{acct}</strong>
        </>
      ) : (
        'This profile has moved'
      )
    }
    action={
      <div className="flex shrink-0 flex-wrap gap-2">
        {acct && href ? (
          <Button type="button" variant="outline" size="sm" asChild>
            {external ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                <ArrowRight aria-hidden="true" />
                Go to new profile
              </a>
            ) : (
              <Link href={href}>
                <ArrowRight aria-hidden="true" />
                Go to new profile
              </Link>
            )}
          </Button>
        ) : null}
        {isOwner ? (
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href="/settings/moving">
              <ArrowRightLeft aria-hidden="true" />
              Manage
            </Link>
          </Button>
        ) : null}
      </div>
    }
  >
    {isOwner && isRedirect
      ? 'You are redirecting from this profile. Followers have not been moved.'
      : 'Follow them at their new profile. Posts here stay as they were.'}
  </Alert>
)
