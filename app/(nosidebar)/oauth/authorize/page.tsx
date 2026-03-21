import { notFound, redirect } from 'next/navigation'
import { FC } from 'react'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { Actor } from '@/lib/types/domain/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { AuthorizeCard } from './AuthorizeCard'
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
  const params = await searchParams
  const parsedResult = SearchParams.safeParse(params)
  if (!parsedResult.success) {
    return notFound()
  }

  const [actor, client] = await Promise.all([
    getActorFromSession(database, session),
    database.getClientFromId({ clientId: params.client_id })
  ])

  if (!client) {
    return notFound()
  }

  if (!actor || !actor.account) {
    const scheme =
      process.env.ACTIVITIES_INSECURE_AUTH === 'true' ? 'http' : 'https'
    const url = new URL('/auth/signin', `${scheme}://${getConfig().host}`)
    url.searchParams.append(
      'redirectBack',
      `/oauth/authorize?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][])}`
    )
    return redirect(url.toString())
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
