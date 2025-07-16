import { Metadata } from 'next'
import { auth } from '@/auth'
import { redirect } from 'next/navigation'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getActorProfile } from '@/lib/models/actor'
import { Timeline } from '@/lib/services/timelines/types'
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

  const session = await auth()
  const actor = await getActorFromSession(database, session)
  if (!actor) {
    return redirect(`https://${host}/auth/signin`)
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
