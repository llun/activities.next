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

interface Props {
  params: Promise<{ actor: string }>
}

export const generateMetadata = async ({
  params
}: Props): Promise<Metadata> => {
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
        '/following'
      )
      if (targetUrl) {
        return {
          title: `Activities.next: ${decodedActorHandle} Following`,
          robots: { index: false, follow: false },
          alternates: {
            canonical: targetUrl
          }
        }
      }
    }
  }

  return {
    title: `Activities.next: ${decodedActorHandle} Following`
  }
}

const Page: FC<Props> = async ({ params }) => {
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
    '/following'
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

  const follows = await database.getFollowing({
    actorId: actorProfile.person.id,
    limit: 100
  })

  const followings = (
    await Promise.all(
      follows.map((follow: Follow) =>
        database.getActorFromId({ id: follow.targetActorId })
      )
    )
  )
    .filter((item): item is Actor => !!item)
    .map((actor) => ActorProfile.parse(actor))
  const blockedActorIds = await getFollowListBlockedActorIds(
    database,
    currentActor?.id,
    followings
  )

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
              <span className="truncate">Following</span>
            </span>
          }
          description={
            typeof actorProfile.followingCount === 'number'
              ? `${actorProfile.followingCount.toLocaleString()} accounts`
              : undefined
          }
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
            <h1 className="text-xl font-semibold tracking-tight">Following</h1>
            {typeof actorProfile.followingCount === 'number' && (
              <p className="text-sm text-muted-foreground">
                {actorProfile.followingCount.toLocaleString()} accounts
              </p>
            )}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
        <FollowList
          users={followings}
          isLoggedIn={isLoggedIn}
          blockedActorIds={blockedActorIds}
          emptyMessage="Not following anyone yet"
        />
      </div>
    </div>
  )
}

export default Page
