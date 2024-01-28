import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { FC } from 'react'
import { z } from 'zod'

import { authOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getConfig } from '@/lib/config'
import { getStorage } from '@/lib/storage'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

const SearchParams = z.object({
  client_id: z.string(),
  scope: z.string(),
  redirect_uri: z.string(),
  response_type: z.literal('code')
})
export type SearchParams = z.infer<typeof SearchParams>

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

  const actor = await getActorFromSession(storage, session)
  if (!actor || !actor.account) {
    const url = new URL('/auth/signin', `https://${getConfig().host}`)
    url.searchParams.append(
      'redirectBack',
      `/oauth/authorize?${new URLSearchParams(Object.entries(searchParams))}`
    )
    return redirect(url.toString())
  }

  return <div>Authorize page</div>
}

export default Page
