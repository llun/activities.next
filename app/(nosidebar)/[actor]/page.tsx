import cn from 'classnames'
import { getServerSession } from 'next-auth'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { authOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getActorPosts, getPublicProfileFromHandle } from '@/lib/activities'
import { FollowAction } from '@/lib/components/FollowAction'
import { Profile } from '@/lib/components/Profile'
import { CACHE_KEY_PREFIX_ACTOR, CACHE_NAMESPACE_ACTORS } from '@/lib/constants'
import { Actor } from '@/lib/models/actor'
import { getStorage } from '@/lib/storage'
import { Storage } from '@/lib/storage/types'
import { cache } from '@/lib/utils/cache'

import { ActorTimelines } from './ActorTimelines'
import styles from './[actor].module.scss'

interface Props {
  params: { actor: string }
}

async function getActorProfile(storage: Storage, actor: Actor) {
  if (!actor.account) {
    const profile = await getPublicProfileFromHandle(
      actor.getMention(true),
      true
    )
    if (!profile) return null

    return cache(
      CACHE_NAMESPACE_ACTORS,
      `${CACHE_KEY_PREFIX_ACTOR}_${actor.getMention(true)}`,
      async () => {
        const [statuses, attachments] = await Promise.all([
          getActorPosts({ postsUrl: profile.urls?.posts }),
          storage.getAttachmentsForActor({ actorId: profile.id })
        ])
        return {
          person: profile,
          statuses,
          attachments: attachments.map((item) => item.toJson())
        }
      }
    )
  }

  return cache(
    CACHE_NAMESPACE_ACTORS,
    `${CACHE_KEY_PREFIX_ACTOR}_${actor}`,
    async () => {
      const [
        statuses,
        statusCount,
        attachments,
        followingCount,
        followersCount
      ] = await Promise.all([
        storage.getActorStatuses({ actorId: actor.id }),
        storage.getActorStatusesCount({ actorId: actor.id }),
        storage.getAttachmentsForActor({ actorId: actor.id }),
        storage.getActorFollowingCount({ actorId: actor.id }),
        storage.getActorFollowersCount({ actorId: actor.id })
      ])
      return {
        person: actor.toPublicProfile({
          followersCount,
          followingCount,
          totalPosts: statusCount
        }),
        statuses: statuses.map((item) => item.toJson()),
        attachments: attachments.map((item) => item.toJson())
      }
    }
  )
}

const Page: FC<Props> = async ({ params }) => {
  const [storage, session] = await Promise.all([
    getStorage(),
    getServerSession(authOptions)
  ])
  if (!storage) throw new Error('Storage is not available')

  const { actor } = params
  const parts = decodeURIComponent(actor).split('@').slice(1)
  if (parts.length !== 2) {
    return notFound()
  }

  const [username, domain] = parts
  const isLoggedIn = Boolean(session?.user?.email)
  const storageActor = await storage.getActorFromUsername({ username, domain })
  if (!storageActor || (!isLoggedIn && !storageActor?.account)) {
    return notFound()
  }

  const actorProfile = await getActorProfile(storage, storageActor)
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
        currentTime={new Date()}
        statuses={statuses}
        attachments={attachments}
      />
    </>
  )
}

export default Page
