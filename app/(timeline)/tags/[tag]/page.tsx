import { Metadata } from 'next'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorProfile } from '@/lib/types/domain/actor'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { HashtagTimeline } from './HashtagTimeline'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ tag: string }>
}

export const generateMetadata = async ({
  params
}: PageProps): Promise<Metadata> => {
  const { tag } = await params
  return {
    title: `#${tag} - Activities.next`
  }
}

const Page = async ({ params }: PageProps) => {
  const { tag } = await params
  const { host } = getConfig()
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)

  const statuses = await database.getStatusesByHashtag({
    hashtag: tag
  })

  const postCount = await database.getHashtagCounter({ hashtag: tag })

  const settings = actor
    ? await database.getActorSettings({ actorId: actor.id })
    : null

  return (
    <HashtagTimeline
      tag={tag}
      host={host}
      statuses={statuses.map((item) => cleanJson(item))}
      postCount={postCount}
      currentActor={actor ? getActorProfile(actor) : undefined}
      postLineLimit={settings?.postLineLimit}
    />
  )
}

export default Page
