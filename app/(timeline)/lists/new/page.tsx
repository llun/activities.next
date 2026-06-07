import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { ListEditor } from '../ListEditor'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: New list'
}

const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor) {
    return redirect('/auth/signin')
  }

  return <ListEditor mode="create" />
}

export default Page
