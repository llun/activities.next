import { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorProfile } from '@/lib/types/domain/actor'
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
  const { host, mediaStorage } = getConfig()
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

  const settings = await database.getActorSettings({ actorId: actor.id })

  return (
    <GearDetailView
      gearId={id}
      // What the activities feed needs and cannot fetch for itself.
      // `getActorProfile`, never the raw `Actor` and never `cleanJson`: this
      // prop crosses into a Client Component and React serialises whatever it
      // is handed into the flight payload embedded in the HTML, and `Actor`
      // carries `privateKey` and the whole `account` row. `currentTime` is the
      // server's `Date.now()` for the same reason every feed passes one — a
      // Client Component reading the clock during render breaks hydration on
      // every relative timestamp below it.
      feed={{
        host,
        currentTime: Date.now(),
        currentActor: getActorProfile(actor),
        isMediaUploadEnabled: Boolean(mediaStorage),
        postLineLimit: settings?.postLineLimit
      }}
    />
  )
}

export default Page
