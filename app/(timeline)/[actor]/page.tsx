import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { Bio } from '@/lib/components/bio/Bio'
import { FollowAction } from '@/lib/components/follow-action/follow-action'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

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
  const actorDomain = parts[1]

  const actorProfile = await getProfileData(
    database,
    decodedActorHandle,
    isLoggedIn
  )
  if (!actorProfile) {
    return notFound()
  }

  const {
    person,
    statuses,
    attachments,
    statusesCount,
    followingCount,
    followersCount
  } = actorProfile

  const currentActor = await getActorFromSession(database, session)
  const isCurrentUser = currentActor?.id === person.id

  const initials = (person.name || '')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()

  const getHeaderImage = () => {
    if (!person.image) return null
    if (typeof person.image === 'string') return null
    if (Array.isArray(person.image)) return null
    if (person.image.type !== 'Image') return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const image = person.image as any
    if (typeof image.url !== 'string') return null
    return image.url
  }

  const getIconImage = () => {
    if (!person.icon) return null
    if (typeof person.icon === 'string') return null
    if (Array.isArray(person.icon)) return null
    if (person.icon.type !== 'Image') return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const image = person.icon as any
    if (typeof image.url !== 'string') return null
    return image.url
  }

  const headerImageUrl = getHeaderImage()
  const iconImageUrl = getIconImage()

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
        <div className="relative h-36 bg-muted md:h-52">
          {headerImageUrl && (
            <img
              src={headerImageUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          )}
        </div>

        <div className="relative px-6 pb-6">
          <Avatar className="relative -mt-10 h-20 w-20 border-4 border-background">
            <AvatarImage src={iconImageUrl || undefined} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">{person.name}</h1>
              <p className="text-muted-foreground">
                @{person.preferredUsername}
              </p>
            </div>
            {isCurrentUser ? (
              <Button variant="outline" asChild>
                <Link href="/settings">Edit Profile</Link>
              </Button>
            ) : (
              <FollowAction targetActorId={person.id} isLoggedIn={isLoggedIn} />
            )}
          </div>

          <Bio summary={person.summary} />

          <div className="mt-5 flex flex-wrap gap-6 text-sm">
            <div>
              <span className="font-semibold">{statusesCount}</span>{' '}
              <span className="text-muted-foreground">Posts</span>
            </div>
            <Link
              href={`/@${person.preferredUsername}@${actorDomain}/following`}
              className="hover:underline"
            >
              <span className="font-semibold">{followingCount}</span>{' '}
              <span className="text-muted-foreground">Following</span>
            </Link>
            <Link
              href={`/@${person.preferredUsername}@${actorDomain}/followers`}
              className="hover:underline"
            >
              <span className="font-semibold">{followersCount}</span>{' '}
              <span className="text-muted-foreground">Followers</span>
            </Link>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
        <ActorTimelines
          host={host}
          actorId={person.id}
          statuses={statuses}
          attachments={attachments}
        />
      </section>
    </div>
  )
}

export default Page
