import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { FC } from 'react'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { Card, CardContent } from '@/lib/components/ui/card'
import { FollowAction } from '@/lib/components/FollowAction'
import { Profile } from '@/lib/components/Profile'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getMentionDomainFromActorID } from '@/lib/models/actor'
import { cn } from '@/lib/utils'

import { ActorTimelines } from './ActorTimelines'
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

  if (!isLoggedIn && !actorProfile.isInternalAccount) {
    return redirect(actorProfile.person.url)
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
      <Card>
        <CardContent className="flex flex-col sm:flex-row p-6">
          {person.icon?.url && (
            <img
              alt="Actor icon"
              className={cn(
                'size-16 sm:size-24 rounded-full mr-4 mb-2 shrink-0'
              )}
              src={person.icon?.url}
            />
          )}
          <Profile
            className="flex-1"
            name={person.name ?? ''}
            url={person.url}
            username={person.preferredUsername}
            domain={getMentionDomainFromActorID(person.id)}
            totalPosts={statusesCount}
            followersCount={followersCount}
            followingCount={followingCount}
            createdAt={new Date(person.published ?? Date.now()).getTime()}
          />
          <FollowAction targetActorId={person.id} isLoggedIn={isLoggedIn} />
        </CardContent>
      </Card>
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
