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
import { Status } from '@/lib/types/domain/status'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { logger } from '@/lib/utils/logger'

import { MainPageTimeline } from './MainPageTimeline'
import { Landing } from './landing/Landing'

// Number of recent public posts previewed in the logged-out landing feed.
const LANDING_FEED_LIMIT = 20
// The landing only previews the public timeline once the server has at least
// this many public posts; below the threshold it shows the brand hero instead,
// so a sparse new server doesn't lead with a near-empty feed.
const LANDING_FEED_MIN_POSTS = 100

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Timeline'
}

const Page = async () => {
  const { host, serviceName, mediaStorage, registrationOpen } = getConfig()
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor) {
    // Logged-out visitors get the landing. The landing only previews the public
    // timeline once the server has a healthy number of public posts
    // (LANDING_FEED_MIN_POSTS); below that it shows the brand hero so a sparse
    // server doesn't lead with a near-empty feed. The right-hand auth card
    // reflects whether sign-up is open. A failure to load the preview degrades
    // to the hero rather than 500-ing the public front door — but it's logged
    // so an outage isn't silently hidden as "no posts".
    let publicStatuses: Status[] = []
    try {
      const publicCount = await database.getLocalPublicStatusesCount()
      if (publicCount >= LANDING_FEED_MIN_POSTS) {
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
        publicStatuses = statuses
      }
    } catch (error) {
      logger.error({
        err: error,
        message: 'Failed to load public posts for the landing page'
      })
    }
    return (
      <Landing
        host={host}
        currentTime={Date.now()}
        statuses={publicStatuses.map((item) => cleanJson(item))}
        serviceName={serviceName ?? 'Activities'}
        signupOpen={registrationOpen}
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
