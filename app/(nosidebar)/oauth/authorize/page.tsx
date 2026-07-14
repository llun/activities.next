import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { FC } from 'react'

import { getBaseURL } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Actor } from '@/lib/types/domain/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { isRealAvatar } from '@/lib/utils/isRealAvatar'

import { AuthorizeCard } from './AuthorizeCard'
import {
  buildBetterAuthAuthorizeUrl,
  buildOAuthAuthorizePath,
  shouldDelegateToBetterAuth
} from './authorizeQuery'
import { SearchParams } from './types'

export const dynamic = 'force-dynamic'

interface Props {
  // Raw query params as Next.js provides them; SearchParams.safeParse below
  // produces the typed/coerced form.
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const Page: FC<Props> = async ({ searchParams }) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const rawParams = await searchParams
  const parsedResult = SearchParams.safeParse(rawParams)
  if (!parsedResult.success) {
    return notFound()
  }
  // `lang` is accepted for Mastodon compatibility but intentionally unused
  // (the consent UI is not localized); destructure it — and force_login,
  // which is consumed right below — away so neither is ever forwarded to
  // better-auth or into sign-in redirectBack URLs.
  const { force_login: forceLogin, lang: _lang, ...params } = parsedResult.data

  // Validate the client request before involving the resource owner or handing
  // it to Better Auth. RFC 6749 §4.1.2.1: an unknown client_id or an
  // unregistered redirect_uri must be reported to the user and must NOT be
  // redirected to the requested redirect_uri.
  //
  // This has to happen ahead of the delegation below. Better Auth's authorize
  // endpoint answers an unknown client with
  // `invalid_client / client_id is required` — the same message it uses for a
  // genuinely missing client_id — and then bounces through /api/auth/error to
  // the home page, so a Mastodon client re-using a client_id this server no
  // longer knows just lands on the timeline and its login silently does
  // nothing.
  const client = await database.getClientFromId({ clientId: params.client_id })
  if (!client) {
    return notFound()
  }

  // Validate redirect_uri against registered URIs to prevent open redirect
  if (
    params.redirect_uri &&
    !client.redirectUris.includes(params.redirect_uri)
  ) {
    return notFound()
  }

  const actor = await getActorFromSession(database, session)

  // Keep sign-in/consent redirects on the host the request actually arrived on
  // (a trusted alias domain falls back to the configured host otherwise) so a
  // login started on a custom domain isn't bounced to ACTIVITIES_HOST. Inherit
  // only the configured scheme (http for ACTIVITIES_INSECURE_AUTH) from
  // getBaseURL(); the validated request host is authoritative for host+port.
  const requestHost = headerHost(await headers())
  const { protocol } = new URL(getBaseURL())
  const requestBaseURL = `${protocol}//${requestHost}`

  // Mastodon `force_login=true` forces re-authentication even when a session
  // exists. redirectBack deliberately omits force_login: once the fresh login
  // happens the requirement is satisfied, and keeping it would bounce the
  // resumed request back to sign-in forever. The extra force_login param on
  // the sign-in URL tells that page to skip its already-authenticated
  // auto-resume so the form actually renders.
  if (!actor || !actor.account || forceLogin) {
    const url = new URL('/auth/signin', requestBaseURL)
    url.searchParams.append('redirectBack', buildOAuthAuthorizePath(params))
    if (forceLogin) url.searchParams.append('force_login', 'true')
    return redirect(url.toString())
  }

  if (shouldDelegateToBetterAuth(params)) {
    return redirect(buildBetterAuthAuthorizeUrl(params, requestBaseURL))
  }

  // Fetch all actors for this account
  let actors: Actor[] = []
  if (actor.account) {
    actors = await database.getActorsForAccount({
      accountId: actor.account.id
    })
  }

  return (
    <div>
      <AuthorizeCard
        searchParams={params}
        client={client}
        actors={actors}
        account={{
          email: actor.account.email,
          name: actor.account.name,
          iconUrl: isRealAvatar(actor.account.iconUrl)
            ? actor.account.iconUrl
            : null
        }}
        currentActorId={actor.id}
      />
    </div>
  )
}

export default Page
