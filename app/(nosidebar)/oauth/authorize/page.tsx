import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { authOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getConfig } from '@/lib/config'
import { getStorage } from '@/lib/storage'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

const Page: FC = async () => {
  const [storage, session] = await Promise.all([
    getStorage(),
    getServerSession(authOptions)
  ])

  if (!storage) {
    throw new Error('Fail to load storage')
  }

  const actor = await getActorFromSession(storage, session)
  if (!actor || !actor.account) {
    const url = new URL('/auth/signin', `https://${getConfig().host}`)
    url.searchParams.append('redirectBack', '/oauth/authorize')
    return redirect(url.toString())
  }

  return <div>Authorize page</div>
}

export default Page
