import { notFound, redirect } from 'next/navigation'
import { FC } from 'react'

import { auth } from '@/auth'
import { getConfig } from '@/lib/config'
import { getStorage } from '@/lib/storage'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { AuthorizeCard } from './AuthorizeCard'
import { SearchParams } from './types'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<SearchParams>
}

const Page: FC<Props> = async ({ searchParams }) => {
  const [storage, session] = await Promise.all([getStorage(), auth()])

  if (!storage) {
    throw new Error('Fail to load storage')
  }

  const params = await searchParams
  const parsedResult = SearchParams.safeParse(params)
  if (!parsedResult.success) {
    return notFound()
  }

  const [actor, client] = await Promise.all([
    getActorFromSession(storage, session),
    storage.getClientFromId({ clientId: params.client_id })
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

  return (
    <div>
      <AuthorizeCard searchParams={params} client={client} />
    </div>
  )
}

export default Page
