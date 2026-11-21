import { ArrowLeft } from 'lucide-react'
import { Metadata } from 'next'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { getAuthLogoSrc } from '@/app/(nosidebar)/getAuthLogoSrc'
import { getBaseURL } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import {
  ACCOUNT_TARGET_MAX_LENGTH,
  resolveAccountTarget
} from '@/lib/services/actors/resolveAccountTarget'
import { ensureServedDomainsFresh } from '@/lib/services/domains/servedDomainSnapshot'
import { headerHost } from '@/lib/services/guards/headerHost'
import { resolveSessionActor } from '@/lib/services/guards/sessionActor'

import { AuthorizeInteractionCard } from './AuthorizeInteractionCard'
import { AuthorizeInteractionError } from './AuthorizeInteractionError'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Follow',
  // The URL carries text a remote server chose; there is nothing here worth
  // indexing and every rendering of it is per-visitor.
  robots: { index: false, follow: false }
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const BackToTimelineLink = () => (
  <div className="mb-4">
    <Link
      href="/"
      prefetch={false}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      <span>Back to timeline</span>
    </Link>
  </div>
)

/**
 * Mastodon-compatible remote-follow landing page. Other servers send a visitor
 * here (via the `http://ostatus.org/schema/1.0/subscribe` WebFinger template,
 * or by guessing this path) with the account they want to follow in `uri`.
 */
const Page: FC<Props> = async ({ searchParams }) => {
  const database = getDatabase()
  if (!database) throw new Error('Database is not available')

  const rawUri = (await searchParams).uri
  const uri = (Array.isArray(rawUri) ? rawUri[0] : rawUri)?.trim() ?? ''

  if (!uri || uri.length > ACCOUNT_TARGET_MAX_LENGTH) {
    return (
      <div>
        <BackToTimelineLink />
        <AuthorizeInteractionError
          logoSrc={getAuthLogoSrc()}
          title="Nothing to follow"
          description="This link is missing the account to follow. Open it again from the other server, or search for the account here."
        />
      </div>
    )
  }

  // Resolve the viewer through the shared guard helper, so a suspended actor or
  // a disabled/unconfirmed account is refused BEFORE `resolveAccountTarget`
  // runs — that call performs outbound WebFinger/fetch work, and a credential
  // must never let a blocked session drive it.
  const resolved = await resolveSessionActor(database)

  if (resolved.type === 'blocked') {
    return (
      <div>
        <BackToTimelineLink />
        <AuthorizeInteractionError
          logoSrc={getAuthLogoSrc()}
          title="You can't follow accounts right now"
          description="This account is suspended, disabled, or its e-mail address is not confirmed. Contact the server administrator if you think this is a mistake."
        />
      </div>
    )
  }

  // Bounce before resolving anything, so an anonymous visitor can never drive
  // an outbound fetch through this page.
  if (resolved.type === 'unauthenticated') {
    // Keep the sign-in redirect on the host the request arrived on so a login
    // started on a trusted alias domain is not bounced to ACTIVITIES_HOST;
    // inherit only the scheme from getBaseURL(). Same rule as /oauth/authorize.
    await ensureServedDomainsFresh()
    const requestHost = headerHost(await headers())
    const { protocol } = new URL(getBaseURL())
    const url = new URL('/auth/signin', `${protocol}//${requestHost}`)
    // Encode the uri into redirectBack's value first: searchParams.append
    // encodes the value once more, and the sign-in page decodes exactly once
    // (searchParams.get), so a uri containing `&` survives the round trip.
    url.searchParams.append(
      'redirectBack',
      `/authorize_interaction?uri=${encodeURIComponent(uri)}`
    )
    return redirect(url.toString())
  }

  const currentActor = resolved.actor

  const result = await resolveAccountTarget({ database, input: uri })

  const renderContent = () => {
    switch (result.type) {
      case 'resolved':
        return (
          <AuthorizeInteractionCard
            logoSrc={getAuthLogoSrc()}
            actor={result.actor}
            isSelf={result.actor.id === currentActor.id}
          />
        )
      case 'forbidden':
        return (
          <AuthorizeInteractionError
            logoSrc={getAuthLogoSrc()}
            title="Can't reach that server"
            description="This server does not federate with the server that account is on."
            uri={uri}
          />
        )
      case 'not-found':
        return (
          <AuthorizeInteractionError
            logoSrc={getAuthLogoSrc()}
            title="Account not found"
            description="We couldn't find that account. Only accounts can be opened from this page — a link to a single post won't work."
            uri={uri}
          />
        )
      default:
        return (
          <AuthorizeInteractionError
            logoSrc={getAuthLogoSrc()}
            title="That doesn't look like an account"
            description="Expected an address like username@example.com or a link to a profile."
            uri={uri}
          />
        )
    }
  }

  return (
    <div>
      <BackToTimelineLink />
      {renderContent()}
    </div>
  )
}

export default Page
