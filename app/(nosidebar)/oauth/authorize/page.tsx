import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { FC } from 'react'

import { authOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getConfig } from '@/lib/config'
import { getStorage } from '@/lib/storage'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { AuthorizeCard } from './AuthorizeCard'
import { SearchParams } from './types'

interface Props {
  searchParams: SearchParams
}

const Page: FC<Props> = async ({ searchParams }) => {
  const [storage, session] = await Promise.all([
    getStorage(),
    getServerSession(authOptions)
  ])

  if (!storage) {
    throw new Error('Fail to load storage')
  }

  const parsedResult = SearchParams.safeParse(searchParams)
  if (!parsedResult.success) {
    return notFound()
  }

  const [actor, client] = await Promise.all([
    getActorFromSession(storage, session),
    storage.getClientFromId({ clientId: searchParams.client_id })
  ])

  if (!client) {
    return notFound()
  }

  if (!actor || !actor.account) {
    const url = new URL('/auth/signin', `https://${getConfig().host}`)
    url.searchParams.append(
      'redirectBack',
      `/oauth/authorize?${new URLSearchParams(Object.entries(searchParams))}`
    )
    return redirect(url.toString())
  }

  return (
    <div>
      <AuthorizeCard searchParams={searchParams} client={client} />
    </div>
  )
}

export default Page
