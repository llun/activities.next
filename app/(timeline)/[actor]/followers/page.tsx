import { ArrowLeft } from 'lucide-react'
import { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { FollowList } from '@/app/(timeline)/[actor]/FollowList'
import { getFollowListBlockedActorIds } from '@/app/(timeline)/[actor]/getFollowListBlockedActorIds'
import { getProfileData } from '@/app/(timeline)/[actor]/getProfileData'
import { Button } from '@/lib/components/ui/button'
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
  return {
    title: `Activities.next: ${decodeURIComponent(actor)} Followers`
  }
}

const Page: FC<Props> = async ({ params }) => {
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
  const actorDomain = parts[1]

  const actorProfile = await getProfileData(
    database,
    decodedActorHandle,
    isLoggedIn
  )
  if (!actorProfile) {
    return notFound()
  }

  const follows = await database.getFollowers({
    targetActorId: actorProfile.person.id,
    limit: 100
  })

  const followers = (
    await Promise.all(
      follows.map((follow: Follow) =>
        database.getActorFromId({ id: follow.actorId })
      )
    )
  )
    .filter((item): item is Actor => !!item)
    .map((actor) => ActorProfile.parse(actor))
  const blockedActorIds = await getFollowListBlockedActorIds(
    database,
    currentActor?.id,
    followers
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link
            href={`/@${actorProfile.person.preferredUsername}@${actorDomain}`}
          >
            <ArrowLeft className="h-5 w-5" />
            <span className="sr-only">Back to profile</span>
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Followers</h1>
          <p className="text-sm text-muted-foreground">
            {actorProfile.followersCount.toLocaleString()} accounts
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
        <FollowList
          users={followers}
          isLoggedIn={isLoggedIn}
          blockedActorIds={blockedActorIds}
        />
      </div>
    </div>
  )
}

export default Page
