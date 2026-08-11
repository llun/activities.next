import { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { GearDetailView } from './GearDetailView'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Fitness Gear'
}

interface PageProps {
  params: Promise<{ id: string }>
}

const Page = async ({ params }: PageProps) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor) {
    return redirect('/auth/signin')
  }

  const { id } = await params
  // Ownership check happens here so a stranger's gear id 404s instead of
  // rendering a shell that then fails to find the row client-side.
  const gear = await database.getFitnessGear({ id, actorId: actor.id })
  if (!gear) {
    return notFound()
  }

  return <GearDetailView gearId={id} />
}

export default Page
