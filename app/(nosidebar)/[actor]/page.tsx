import cn from 'classnames'
import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { FollowAction } from '@/lib/components/FollowAction'
import { Profile } from '@/lib/components/Profile'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getMentionDomainFromActorID } from '@/lib/models/actor'

import { ActorTimelines } from './ActorTimelines'
import styles from './[actor].module.scss'
import { getProfileData } from './getProfileData'

interface Props {
  params: Promise<{ actor: string }>
}

export const generateMetadata = async ({
  params
}: Props): Promise<Metadata> => {
  const { actor } = await params
  return {
    title: `Activities.next: ${decodeURIComponent(actor)}`
  }
}

const Page: FC<Props> = async ({ params }) => {
  const { host } = getConfig()
  const database = getDatabase()
  if (!database) throw new Error('Database is not available')

  const session = await getServerSession(getAuthOptions())
  const isLoggedIn = Boolean(session?.user?.email)
  if (!isLoggedIn) {
    return notFound()
  }

  const { actor } = await params
  const decodedActorHandle = decodeURIComponent(actor)
  const parts = decodedActorHandle.split('@').slice(1)
  if (parts.length !== 2) {
    return notFound()
  }

  const actorProfile = await getProfileData(database, decodedActorHandle)
  if (!actorProfile) {
    return notFound()
  }

  const {
    person,
    statuses,
    statusesCount,
    attachments,
    followingCount,
    followersCount
  } = actorProfile

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
            name={person.name ?? ''}
            url={person.url}
            username={person.preferredUsername}
            domain={getMentionDomainFromActorID(person.id)}
            totalPosts={statusesCount}
            followersCount={followersCount}
            followingCount={followingCount}
            createdAt={new Date(person.published).getTime()}
          />
          <FollowAction targetActorId={person.id} isLoggedIn={isLoggedIn} />
        </div>
      </section>
      <ActorTimelines
        host={host}
        currentTime={new Date()}
        statuses={statuses}
        attachments={attachments.map((attachment) => attachment.data)}
      />
    </>
  )
}

export default Page
