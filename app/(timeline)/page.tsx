import { Metadata } from 'next'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import {
  getFilteredStatusPage,
  getFilteredTimelinePage
} from '@/lib/services/timelines/getFilteredTimelinePage'
import { Timeline } from '@/lib/services/timelines/types'
import { getActorProfile } from '@/lib/types/domain/actor'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { MainPageTimeline } from './MainPageTimeline'
import { Landing } from './landing/Landing'

// Number of recent public posts previewed in the logged-out landing feed.
const LANDING_FEED_LIMIT = 5

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Timeline'
}

const Page = async () => {
  const { host, serviceName, mediaStorage } = getConfig()
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor) {
    // Logged-out visitors get the landing. When the server has public posts the
    // landing previews its recent public timeline; otherwise it shows the brand
    // hero. Both variants share the create/sign-in card.
    const { statuses } = await getFilteredStatusPage({
      database,
      limit: LANDING_FEED_LIMIT,
      fetchBatch: ({ maxStatusId, limit }) =>
        database.getTimeline({
          timeline: Timeline.LOCAL_PUBLIC,
          maxStatusId,
          limit
        })
    })
    return (
      <Landing
        host={host}
        currentTime={Date.now()}
        statuses={statuses.map((item) => cleanJson(item))}
        serviceName={serviceName ?? 'Activities'}
      />
    )
  }

  const settings = await database.getActorSettings({ actorId: actor.id })
  const { statuses, nextMaxStatusId } = await getFilteredTimelinePage({
    database,
    timeline: Timeline.MAIN,
    actorId: actor.id
  })
  return (
    <MainPageTimeline
      host={host}
      currentTime={Date.now()}
      statuses={statuses.map((item) => cleanJson(item))}
      initialNextMaxStatusId={nextMaxStatusId}
      profile={getActorProfile(actor)}
      isMediaUploadEnabled={Boolean(mediaStorage)}
      postLineLimit={settings?.postLineLimit}
    />
  )
}

export default Page
