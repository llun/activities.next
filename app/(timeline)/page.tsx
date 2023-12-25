import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'

import { getConfig } from '@/lib/config'
import { getStorage } from '@/lib/storage'
import { Timeline } from '@/lib/timelines/types'

import { authOptions } from '../api/auth/[...nextauth]/authOptions'
import { MainPageTimeline } from './MainPageTimeline'
import { getActorFromSession } from './getActorFromSession'

const Page = async () => {
  const { host, mediaStorage } = getConfig()
  const [storage, session] = await Promise.all([
    getStorage(),
    getServerSession(authOptions)
  ])

  if (!storage) {
    throw new Error('Fail to load storage')
  }

  const actor = await getActorFromSession(storage, session)
  if (!actor) {
    return redirect('/auth/signin')
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
