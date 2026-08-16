import { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { getBaseURL } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import {
  ACCOUNT_TARGET_MAX_LENGTH,
  resolveAccountTarget
} from '@/lib/services/actors/resolveAccountTarget'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { AuthorizeInteractionCard } from './AuthorizeInteractionCard'
import { AuthorizeInteractionError } from './AuthorizeInteractionError'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Follow',
  // The URL carries text a remote server chose; there is nothing here worth
  // indexing and every rendering of it is per-visitor.
  robots: { index: false, follow: false }
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

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
      <AuthorizeInteractionError
        title="Nothing to follow"
        description="This link is missing the account to follow. Open it again from the other server, or search for the account here."
      />
    )
  }

  const session = await getServerAuthSession()
  const currentActor = await getActorFromSession(database, session)

  // Bounce before resolving anything, so an anonymous visitor can never drive
  // an outbound fetch through this page.
  if (!currentActor) {
    // Keep the sign-in redirect on the host the request arrived on so a login
    // started on a trusted alias domain is not bounced to ACTIVITIES_HOST;
    // inherit only the scheme from getBaseURL(). Same rule as /oauth/authorize.
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

  const result = await resolveAccountTarget({ database, input: uri })

  switch (result.type) {
    case 'resolved':
      return (
        <AuthorizeInteractionCard
          actor={result.actor}
          isSelf={result.actor.id === currentActor.id}
        />
      )
    case 'forbidden':
      return (
        <AuthorizeInteractionError
          title="Can't reach that server"
          description="This server does not federate with the server that account is on."
          uri={uri}
        />
      )
    case 'not-found':
      return (
        <AuthorizeInteractionError
          title="Account not found"
          description="We couldn't find that account. Only accounts can be opened from this page — a link to a single post won't work."
          uri={uri}
        />
      )
    default:
      return (
        <AuthorizeInteractionError
          title="That doesn't look like an account"
          description="Expected an address like username@example.com or a link to a profile."
          uri={uri}
        />
      )
  }
}

export default Page
