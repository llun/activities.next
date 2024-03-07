import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'

import { getConfig } from '@/lib/config'
import { Timeline } from '@/lib/services/timelines/types'
import { getStorage } from '@/lib/storage'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { getAuthOptions } from '../api/auth/[...nextauth]/authOptions'
import { MainPageTimeline } from './MainPageTimeline'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Timeline'
}

const Page = async () => {
  const { host, mediaStorage } = getConfig()
  const [storage, session] = await Promise.all([
    getStorage(),
    getServerSession(getAuthOptions())
  ])

  if (!storage) {
    throw new Error('Fail to load storage')
  }

  const actor = await getActorFromSession(storage, session)
  if (!actor) {
    return redirect(`https://${host}/auth/signin`)
  }

  const statuses = await storage.getTimeline({
    timeline: Timeline.MAIN,
    actorId: actor.id
  })
  return (
    <MainPageTimeline
      host={host}
      statuses={statuses.map((item) => item.toJson())}
      profile={actor.toProfile()}
      isMediaUploadEnabled={Boolean(mediaStorage)}
    />
  )
}

export default Page
