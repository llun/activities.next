import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { FC } from 'react'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { Actor } from '@/lib/models/actor'
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

  const session = await getServerSession(getAuthOptions())
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
    const url = new URL('/auth/signin', `https://${getConfig().host}`)
    url.searchParams.append(
      'redirectBack',
      `/oauth/authorize?${new URLSearchParams(Object.entries(params))}`
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
