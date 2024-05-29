import cn from 'classnames'
import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { FollowAction } from '@/lib/components/FollowAction'
import { Profile } from '@/lib/components/Profile'
import { getConfig } from '@/lib/config'
import { getStorage } from '@/lib/storage'

import { ActorTimelines } from './ActorTimelines'
import styles from './[actor].module.scss'
import { getExternalActorProfile } from './getExternalActorProfile'
import { getInternalActorProfile } from './getInternalActorProfile'

interface Props {
  params: { actor: string }
}

export const generateMetadata = async ({
  params
}: Props): Promise<Metadata> => {
  return {
    title: `Activities.next: ${decodeURIComponent(params.actor)}`
  }
}

const Page: FC<Props> = async ({ params }) => {
  const { host } = getConfig()
  const [storage, session] = await Promise.all([
    getStorage(),
    getServerSession(getAuthOptions())
  ])
  if (!storage) throw new Error('Storage is not available')

  const { actor } = params
  const decodedActorHandle = decodeURIComponent(actor)
  const parts = decodedActorHandle.split('@').slice(1)
  if (parts.length !== 2) {
    return notFound()
  }

  const [username, domain] = parts
  const isLoggedIn = Boolean(session?.user?.email)
  const storageActor = await storage.getActorFromUsername({ username, domain })

  if (!isLoggedIn && !storageActor?.account) {
    return notFound()
  }

  const actorProfile = storageActor?.account
    ? await getInternalActorProfile(storage, storageActor)
    : await getExternalActorProfile(storage, decodedActorHandle)
  if (!actorProfile) {
    return notFound()
  }

  const { person, statuses, attachments } = actorProfile

  return (
    <>
      <section className="card">
        <div className="card-body d-flex flex-column flex-sm-row">
          {person.icon?.url && (
            <img
              alt="Actor icon"
              className={cn(styles.icon, 'me-4', 'mb-2', 'flex-shrink-0')}
              src={person.icon?.url}
            />
          )}
          <Profile
            className="flex-fill"
            name={person.name}
            url={person.url}
            username={person.username}
            domain={person.domain}
            totalPosts={person.totalPosts}
            followersCount={person.followersCount}
            followingCount={person.followingCount}
            createdAt={person.createdAt}
          />
          <FollowAction targetActorId={person.id} isLoggedIn={isLoggedIn} />
        </div>
      </section>
      <ActorTimelines
        host={host}
        currentTime={new Date()}
        statuses={statuses}
        attachments={attachments}
      />
    </>
  )
}

export default Page
