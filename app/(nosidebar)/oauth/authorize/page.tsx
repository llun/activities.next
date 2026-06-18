import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { FC } from 'react'

import { getBaseURL } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Actor } from '@/lib/types/domain/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { AuthorizeCard } from './AuthorizeCard'
import {
  buildBetterAuthAuthorizeUrl,
  buildOAuthAuthorizePath,
  shouldDelegateToBetterAuth
} from './authorizeQuery'
import { SearchParams } from './types'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<SearchParams>
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
  const params = parsedResult.data

  const actor = await getActorFromSession(database, session)

  // Keep sign-in/consent redirects on the host the request actually arrived on
  // (a trusted alias domain falls back to the configured host otherwise) so a
  // login started on a custom domain isn't bounced to ACTIVITIES_HOST. Start
  // from getBaseURL() to inherit the configured scheme (http for
  // ACTIVITIES_INSECURE_AUTH) and swap only the host via the URL API.
  const requestBaseUrl = new URL(getBaseURL())
  requestBaseUrl.host = headerHost(await headers())
  const requestBaseURL = requestBaseUrl.toString()

  if (!actor || !actor.account) {
    const url = new URL('/auth/signin', requestBaseURL)
    url.searchParams.append('redirectBack', buildOAuthAuthorizePath(params))
    return redirect(url.toString())
  }

  if (shouldDelegateToBetterAuth(params)) {
    return redirect(buildBetterAuthAuthorizeUrl(params, requestBaseURL))
  }

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
        currentActorId={actor.id}
      />
    </div>
  )
}

export default Page
