import { ExternalLink } from 'lucide-react'
import { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { getActorEmojiTags } from '@/lib/actions/utils'
import { getUrl } from '@/lib/activities/note'
import { ActorDisplayName } from '@/lib/components/actors/ActorDisplayName'
import { Bio } from '@/lib/components/bio/Bio'
import { FeaturedTagsBlock } from '@/lib/components/profile/FeaturedTagsBlock'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getMastodonFeaturedTag } from '@/lib/services/mastodon/getMastodonFeaturedTag'
import { getActorProfile } from '@/lib/types/domain/actor'
import { cn } from '@/lib/utils'
import { getActorImageUrl } from '@/lib/utils/activitypubActor'
import { formatServerSoftware } from '@/lib/utils/formatServerSoftware'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { ActorRedirectCard } from './ActorRedirectCard'
import { ActorTimelines } from './ActorTimelines'
import { ProfileHeaderImage } from './ProfileHeaderImage'
import { ProfileRelationshipActions } from './ProfileRelationshipActions'
import { getProfileData } from './getProfileData'
import { getNonLocalActorRedirectTarget } from './resolveActorRedirect'

interface Props {
  params: Promise<{ actor: string }>
}

const getInitials = (name: string, fallback: string) => {
  const cleanName = name.replaceAll(/:[^\s:]{1,64}:/g, '').trim()
  return (cleanName || fallback)
    .trim()
    .split(/\s+/)
    .map((part) => Array.from(part)[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
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
      const session = await getServerAuthSession()
      const isLoggedIn = Boolean(session?.user?.email)
      const targetUrl = await getNonLocalActorRedirectTarget(
        database,
        username,
        domain,
        ''
      )
      // page.tsx-only gate: a signed-in visitor still gets a chance to
      // resolve the actor locally (see getNonLocalActorRedirectTarget).
      if (!isLoggedIn && targetUrl) {
        return {
          title: `Activities.next: ${decodedActorHandle}`,
          robots: { index: false, follow: false },
          alternates: {
            canonical: targetUrl
          }
        }
      }
    }
  }

  return {
    title: `Activities.next: ${decodedActorHandle}`
  }
}

const Page: FC<Props> = async ({ params }) => {
  const { host, mediaStorage } = getConfig()
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
  const [actorUsername, actorDomain] = parts

  // Resolve the viewer's actor for relationship/ownership checks, settings, and
  // timeline rendering. Remote-fetch signing is handled inside getProfileData
  // via the headless instance actor, not the viewer.
  const currentActor = await getActorFromSession(database, session)
  const actorSettings = currentActor
    ? await database.getActorSettings({ actorId: currentActor.id })
    : undefined

  const actorProfile = await getProfileData(
    database,
    decodedActorHandle,
    isLoggedIn,
    { currentActor }
  )
  if (!actorProfile) {
    const targetUrl = await getNonLocalActorRedirectTarget(
      database,
      actorUsername,
      actorDomain,
      ''
    )
    // page.tsx-only gate: only redirect a logged-out visitor (see
    // getNonLocalActorRedirectTarget).
    if (!isLoggedIn && targetUrl) {
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

    return notFound()
  }

  const {
    person,
    statuses,
    attachments,
    statusesCount,
    statusPagination,
    followingCount,
    followersCount,
    hasFitnessData,
    isPixelfed,
    isInternalAccount,
    isMediaOnly,
    serverSoftware
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
    const imageItem = Array.isArray(person.image)
      ? person.image.find(
          (item) =>
            item &&
            typeof item === 'object' &&
            'url' in item &&
            typeof item.url === 'string'
        )
      : person.image
    if (
      !imageItem ||
      imageItem.type !== 'Image' ||
      typeof imageItem.url !== 'string'
    ) {
      return null
    }
    return {
      url: imageItem.url,
      mediaType: imageItem.mediaType ?? null
    }
  }

  const headerImage = getHeaderImage()
  const headerImageUrl = headerImage?.url ?? null
  const headerImageMediaType = headerImage?.mediaType ?? null
  const iconImageUrl = getActorImageUrl(person.icon) ?? null
  const rawUrl = person.url ? getUrl(person.url) : null
  const profileUrl =
    (rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : null) ||
    (/^https?:\/\//i.test(person.id) ? person.id : null) ||
    `https://${actorDomain}/@${actorUsername}`

  const formattedSoftware = serverSoftware
    ? formatServerSoftware(serverSoftware)
    : null

  return (
    <div className={cn('space-y-6', isLoggedIn && 'pt-6 sm:pt-8')}>
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

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold break-words">
                <ActorDisplayName
                  name={person.name}
                  tags={getActorEmojiTags(person)}
                />
              </h1>
              <p className="truncate text-muted-foreground">
                <a
                  href={profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:underline hover:text-foreground"
                  title="Open profile page"
                >
                  <span>@{person.preferredUsername}</span>
                  <ExternalLink className="size-3.5" />
                </a>
              </p>
            </div>
            {isCurrentUser ? (
              <Button variant="outline" asChild className="shrink-0">
                <Link href="/settings">Edit Profile</Link>
              </Button>
            ) : (
              <ProfileRelationshipActions
                targetActorId={person.id}
                targetHandle={`${person.preferredUsername}@${actorDomain}`}
                isLoggedIn={isLoggedIn}
                relationship={relationship}
              />
            )}
          </div>

          <Bio summary={person.summary} tags={getActorEmojiTags(person)} />

          {(statusesCount !== null ||
            followingCount !== null ||
            followersCount !== null) && (
            <div className="mt-5 flex flex-wrap gap-6 text-sm">
              {statusesCount !== null && (
                <div>
                  <span className="font-semibold">{statusesCount}</span>{' '}
                  <span className="text-muted-foreground">Posts</span>
                </div>
              )}
              {followingCount !== null && (
                <Link
                  href={`/@${person.preferredUsername}@${actorDomain}/following`}
                  prefetch={false}
                  className="hover:underline"
                >
                  <span className="font-semibold">{followingCount}</span>{' '}
                  <span className="text-muted-foreground">Following</span>
                </Link>
              )}
              {followersCount !== null && (
                <Link
                  href={`/@${person.preferredUsername}@${actorDomain}/followers`}
                  prefetch={false}
                  className="hover:underline"
                >
                  <span className="font-semibold">{followersCount}</span>{' '}
                  <span className="text-muted-foreground">Followers</span>
                </Link>
              )}
            </div>
          )}

          {formattedSoftware && (
            <div
              className={cn(
                'text-sm text-muted-foreground break-words',
                statusesCount !== null ||
                  followingCount !== null ||
                  followersCount !== null
                  ? 'mt-3'
                  : 'mt-5'
              )}
            >
              {formattedSoftware}
            </div>
          )}

          <FeaturedTagsBlock tags={featuredTags} />
        </div>
      </section>

      <ActorTimelines
        key={person.id}
        host={host}
        actorId={person.id}
        currentTime={Date.now()}
        statuses={statuses}
        attachments={attachments}
        statusPagination={statusPagination}
        postLineLimit={actorSettings?.postLineLimit}
        currentActor={currentActor ? getActorProfile(currentActor) : undefined}
        isCurrentUser={isCurrentUser}
        isPixelfed={isLoggedIn && Boolean(isPixelfed)}
        isMediaOnly={isLoggedIn && Boolean(isMediaOnly)}
        hasFitnessData={hasFitnessData}
        isMediaUploadEnabled={Boolean(mediaStorage)}
        isInternalAccount={isInternalAccount}
      />
    </div>
  )
}

export default Page
