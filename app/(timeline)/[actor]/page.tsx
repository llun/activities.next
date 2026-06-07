import { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { Bio } from '@/lib/components/bio/Bio'
import { FeaturedTagsBlock } from '@/lib/components/profile/FeaturedTagsBlock'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getMastodonFeaturedTag } from '@/lib/services/mastodon/getMastodonFeaturedTag'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { ActorTimelines } from './ActorTimelines'
import { ProfileHeaderImage } from './ProfileHeaderImage'
import { ProfileRelationshipActions } from './ProfileRelationshipActions'
import { getProfileData } from './getProfileData'

interface Props {
  params: Promise<{ actor: string }>
}

const getInitials = (name: string, fallback: string) =>
  (name || fallback)
    .trim()
    .split(/\s+/)
    .map((part) => Array.from(part)[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

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

  const session = await getServerAuthSession()
  const isLoggedIn = Boolean(session?.user?.email)
  const { actor } = await params
  const decodedActorHandle = decodeURIComponent(actor)
  const parts = decodedActorHandle.split('@').slice(1)
  if (parts.length !== 2) {
    return notFound()
  }
  const actorDomain = parts[1]

  // Get current actor first so we can use it to sign requests for remote actors
  const currentActor = await getActorFromSession(database, session)
  const actorSettings = currentActor
    ? await database.getActorSettings({ actorId: currentActor.id })
    : undefined

  const actorProfile = await getProfileData(
    database,
    decodedActorHandle,
    isLoggedIn,
    currentActor ?? undefined
  )
  if (!actorProfile) {
    return notFound()
  }

  const {
    person,
    statuses,
    attachments,
    statusesCount,
    statusPagination,
    followingCount,
    followersCount
  } = actorProfile

  const isCurrentUser = currentActor?.id === person.id
  const relationship =
    currentActor && !isCurrentUser
      ? await getRelationship({
          database,
          currentActor,
          targetActorId: person.id
        })
      : null

  const initials = getInitials(person.name || '', person.preferredUsername)

  // Surface the account's featured hashtags inside the profile card. Only local
  // actors have stored featured tags; remote profiles resolve to an empty list,
  // so the block hides itself.
  const bareHost = host.includes('://') ? new URL(host).host : host
  const featuredTagRows = await database.getFeaturedTags({
    actorId: person.id
  })
  const featuredTags = featuredTagRows.map((tag) =>
    getMastodonFeaturedTag({
      host: bareHost,
      actor: { username: person.preferredUsername, domain: actorDomain },
      tag
    })
  )

  const getHeaderImage = () => {
    if (!person.image) return null
    if (typeof person.image === 'string') return null
    if (Array.isArray(person.image)) return null
    if (person.image.type !== 'Image') return null
    return {
      url: person.image.url,
      mediaType: person.image.mediaType ?? null
    }
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

  const headerImage = getHeaderImage()
  const headerImageUrl = headerImage?.url ?? null
  const headerImageMediaType = headerImage?.mediaType ?? null
  const iconImageUrl = getIconImage()

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
        <ProfileHeaderImage
          actorId={person.id}
          imageUrl={headerImageUrl}
          mediaType={headerImageMediaType}
        />

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
              <ProfileRelationshipActions
                targetActorId={person.id}
                isLoggedIn={isLoggedIn}
                relationship={relationship}
              />
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

          <FeaturedTagsBlock tags={featuredTags} />
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
        <ActorTimelines
          key={person.id}
          host={host}
          actorId={person.id}
          currentTime={Date.now()}
          statuses={statuses}
          attachments={attachments}
          statusPagination={statusPagination}
          postLineLimit={actorSettings?.postLineLimit}
        />
      </section>
    </div>
  )
}

export default Page
