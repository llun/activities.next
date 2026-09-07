import { ArrowLeft } from 'lucide-react'
import { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { ActorRedirectCard } from '@/app/(timeline)/[actor]/ActorRedirectCard'
import { FollowList } from '@/app/(timeline)/[actor]/FollowList'
import { getFollowListBlockedActorIds } from '@/app/(timeline)/[actor]/getFollowListBlockedActorIds'
import { getProfileData } from '@/app/(timeline)/[actor]/getProfileData'
import { getNonLocalActorRedirectTarget } from '@/app/(timeline)/[actor]/resolveActorRedirect'
import { PageHeader } from '@/lib/components/page-header'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { Actor, ActorProfile } from '@/lib/types/domain/actor'
import { Follow } from '@/lib/types/domain/follow'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

type ProfileData = NonNullable<Awaited<ReturnType<typeof getProfileData>>>

export type FollowListDirection = 'followers' | 'following'

interface DirectionConfig {
  label: string
  subpath: '/followers' | '/following'
  emptyMessage: string
  getCount: (profile: ProfileData) => number | null | undefined
  getFollows: (
    database: NonNullable<ReturnType<typeof getDatabase>>,
    targetActorId: string
  ) => Promise<Follow[]>
  extractActorIds: (follows: Follow[]) => string[]
}

const DIRECTION_CONFIGS: Record<FollowListDirection, DirectionConfig> = {
  followers: {
    label: 'Followers',
    subpath: '/followers',
    emptyMessage: 'No followers yet',
    getCount: (profile) => profile.followersCount,
    getFollows: (database, targetActorId) =>
      database.getFollowers({ targetActorId, limit: 100 }),
    extractActorIds: (follows) => follows.map((f) => f.actorId)
  },
  following: {
    label: 'Following',
    subpath: '/following',
    emptyMessage: 'Not following anyone yet',
    getCount: (profile) => profile.followingCount,
    getFollows: (database, actorId) =>
      database.getFollowing({ actorId, limit: 100 }),
    extractActorIds: (follows) => follows.map((f) => f.targetActorId)
  }
}

export interface FollowListPageProps {
  params: Promise<{ actor: string }>
  direction: FollowListDirection
}

export const generateFollowListMetadata = async ({
  params,
  direction
}: FollowListPageProps): Promise<Metadata> => {
  const config = DIRECTION_CONFIGS[direction]
  const { actor } = await params
  const decodedActorHandle = decodeURIComponent(actor)
  const parts = decodedActorHandle.split('@').slice(1)
  if (parts.length === 2) {
    const [username, domain] = parts
    const database = getDatabase()
    if (database) {
      const targetUrl = await getNonLocalActorRedirectTarget(
        database,
        username,
        domain,
        config.subpath
      )
      if (targetUrl) {
        return {
          title: `Activities.next: ${decodedActorHandle} ${config.label}`,
          robots: { index: false, follow: false },
          alternates: {
            canonical: targetUrl
          }
        }
      }
    }
  }

  return {
    title: `Activities.next: ${decodedActorHandle} ${config.label}`
  }
}

export const FollowListPage: FC<FollowListPageProps> = async ({
  params,
  direction
}) => {
  const config = DIRECTION_CONFIGS[direction]
  const { host } = getConfig()
  const database = getDatabase()
  if (!database) throw new Error('Database is not available')

  const session = await getServerAuthSession()
  const isLoggedIn = Boolean(session?.user?.email)
  const currentActor = await getActorFromSession(database, session)
  const { actor } = await params
  const decodedActorHandle = decodeURIComponent(actor)
  const parts = decodedActorHandle.split('@').slice(1)
  if (parts.length !== 2) {
    return notFound()
  }
  const [actorUsername, actorDomain] = parts

  const targetUrl = await getNonLocalActorRedirectTarget(
    database,
    actorUsername,
    actorDomain,
    config.subpath
  )
  if (targetUrl) {
    const bareHost = host.includes('://') ? new URL(host).host : host
    return (
      <ActorRedirectCard
        host={bareHost}
        targetUrl={targetUrl}
        domain={actorDomain}
        username={actorUsername}
      />
    )
  }

  const actorProfile = await getProfileData(
    database,
    decodedActorHandle,
    isLoggedIn,
    { currentActor }
  )
  if (!actorProfile) {
    return notFound()
  }

  const follows = await config.getFollows(database, actorProfile.person.id)
  const actorIds = config.extractActorIds(follows)
  const rawActors = await database.getActorsFromIds({ ids: actorIds })
  const actorById = new Map(rawActors.map((a) => [a.id, a]))
  const users = actorIds
    .map((id) => actorById.get(id))
    .filter((item): item is Actor => Boolean(item))
    .map((item) => ActorProfile.parse(item))

  const blockedActorIds = await getFollowListBlockedActorIds(
    database,
    currentActor?.id,
    users
  )

  const count = config.getCount(actorProfile)
  const countDescription =
    typeof count === 'number' ? `${count.toLocaleString()} accounts` : undefined

  return (
    <div className="space-y-6">
      {isLoggedIn ? (
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              <Link
                href={`/@${actorProfile.person.preferredUsername}@${actorDomain}`}
                prefetch={false}
                aria-label="Back to profile"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <span className="truncate">{config.label}</span>
            </span>
          }
          description={countDescription}
        />
      ) : (
        <div className="flex items-start gap-2">
          <Link
            href={`/@${actorProfile.person.preferredUsername}@${actorDomain}`}
            prefetch={false}
            aria-label="Back to profile"
            className="mt-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {config.label}
            </h1>
            {countDescription && (
              <p className="text-sm text-muted-foreground">
                {countDescription}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
        <FollowList
          users={users}
          isLoggedIn={isLoggedIn}
          blockedActorIds={blockedActorIds}
          emptyMessage={config.emptyMessage}
        />
      </div>
    </div>
  )
}
