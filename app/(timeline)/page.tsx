import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { Timeline } from '@/lib/services/timelines/types'
import { getActorProfile } from '@/lib/types/domain/actor'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { MainPageTimeline } from './MainPageTimeline'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Timeline'
}

const Page = async () => {
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

  const statuses = await database.getTimeline({
    timeline: Timeline.MAIN,
    actorId: actor.id
  })
  return (
    <MainPageTimeline
      host={host}
      statuses={statuses.map((item) => cleanJson(item))}
      profile={getActorProfile(actor)}
      isMediaUploadEnabled={Boolean(mediaStorage)}
    />
  )
}

export default Page
