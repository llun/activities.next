import { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getMastodonList } from '@/lib/services/mastodon/getMastodonList'
import { getActorProfile } from '@/lib/types/domain/actor'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { ListTimeline } from './ListTimeline'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export const generateMetadata = async ({
  params
}: PageProps): Promise<Metadata> => {
  const database = getDatabase()
  const session = await getServerAuthSession()
  const actor = database ? await getActorFromSession(database, session) : null
  if (!database || !actor) return { title: 'Activities.next: Lists' }

  const { id } = await params
  const list = await database.getList({ id, actorId: actor.id })
  return {
    title: list ? `Activities.next: ${list.title}` : 'Activities.next: Lists'
  }
}

const Page = async ({ params }: PageProps) => {
  const { host, mediaStorage } = getConfig()
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor) {
    return redirect('/auth/signin')
  }

  const { id } = await params
  const list = await database.getList({ id, actorId: actor.id })
  if (!list) {
    return notFound()
  }

  const settings = await database.getActorSettings({ actorId: actor.id })
  const statuses = await database.getListTimeline({
    listId: id,
    actorId: actor.id,
    limit: 20
  })
  const counts = await database.getListAccountCounts({
    actorId: actor.id,
    listIds: [id]
  })

  return (
    <ListTimeline
      host={host}
      list={getMastodonList(list)}
      memberCount={counts[id] ?? 0}
      statuses={statuses.map((status) => cleanJson(status))}
      currentTime={Date.now()}
      currentActor={getActorProfile(actor)}
      isMediaUploadEnabled={Boolean(mediaStorage)}
      postLineLimit={settings?.postLineLimit}
    />
  )
}

export default Page
