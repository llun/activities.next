import {
  ArrowRightLeft,
  ExternalLink,
  FileText,
  Info,
  type LucideIcon,
  UserCheck,
  Users
} from 'lucide-react'
import { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { getActorEmojiTags } from '@/lib/actions/utils'
import { getUrl } from '@/lib/activities/note'
import { ActorDisplayName } from '@/lib/components/actors/ActorDisplayName'
import { Bio } from '@/lib/components/bio/Bio'
import { MobileNavigationTrigger } from '@/lib/components/layout/mobile-navigation-trigger'
import { FeaturedTagsBlock } from '@/lib/components/profile/FeaturedTagsBlock'
import { ProfileFieldsBlock } from '@/lib/components/profile/ProfileFieldsBlock'
import { StatCell } from '@/lib/components/surface/StatCell'
import { StatStrip } from '@/lib/components/surface/StatStrip'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import { getConfig } from '@/lib/config'
import { getPublicMapProvider } from '@/lib/config/mapProvider'
import { getDatabase } from '@/lib/database'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getMastodonFeaturedTag } from '@/lib/services/mastodon/getMastodonFeaturedTag'
import { getActorProfile } from '@/lib/types/domain/actor'
import { cn } from '@/lib/utils'
import { formatServerSoftware } from '@/lib/utils/formatServerSoftware'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { ActorRedirectCard } from './ActorRedirectCard'
import { ActorTimelines } from './ActorTimelines'
import { EditOwnedProfileButton } from './EditOwnedProfileButton'
import { ProfileCover } from './ProfileCover'
import { ProfileHeaderImage } from './ProfileHeaderImage'
import { ProfileMovedBanner } from './ProfileMovedBanner'
import { ProfileRelationshipActions } from './ProfileRelationshipActions'
import { getProfileData } from './getProfileData'
import { getNonLocalActorRedirectTarget } from './resolveActorRedirect'

interface Props {
  params: Promise<{ actor: string }>
}

interface CountCell {
  label: string
  icon: LucideIcon
  count: number
  /** The list behind the number; a cell without one is plain. */
  href?: string
}

const numberFormatter = new Intl.NumberFormat('en-US')
const formatNumber = (count: number): string => {
  if (typeof count !== 'number' || Number.isNaN(count)) return '0'
  return numberFormatter.format(Math.max(0, count))
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
          title: decodedActorHandle,
          robots: { index: false, follow: false },
          alternates: {
            canonical: targetUrl
          }
        }
      }
    }
  }

  return {
    title: decodedActorHandle
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
          pageTitle="Profile"
        />
      )
    }

    return notFound()
  }

  const {
    person,
    profileFields,
    statuses,
    attachments,
    statusesCount,
    statusPagination,
    followingCount,
    followersCount,
    hasFitnessData,
    gallerySubviews,
    tabVisibility,
    isPixelfed,
    isMediaService,
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

  // A profile that moved points at its new account. The target is resolved
  // from the stored actor row only — never fetched — and the migration row
  // for that target tells a cancellable redirect from a performed move.
  // The kind is decided from the pointer, not the target row, so a redirect
  // whose target actor row is gone still reads as a redirect, exactly as
  // Settings › Moving reads the same pointer; only the owner's copy uses it,
  // so the migrations are read only for the owner. A pointer whose actor
  // row is missing still moved: the banner draws without the link, and
  // Follow stays off (the server refuses new follows of a moved account
  // whether or not the target is stored).
  const movedTarget = person.movedTo
    ? await database.getActorFromId({ id: person.movedTo })
    : null
  const movedKind =
    person.movedTo && isCurrentUser
      ? ((await database.getActorMigrations({ actorId: person.id })).find(
          (migration) => migration.targetActorId === person.movedTo
        )?.kind ?? 'move')
      : null

  // A local profile of the signed-in account that is not the active actor gets
  // "Edit profile" in place of the relationship actions: the button switches to
  // it first. Remote profiles and the active actor never read the account's
  // actors, and a profile whose deletion is scheduled or running is left out.
  const accountId = currentActor?.account?.id
  const isOwnedInactiveProfile =
    isInternalAccount &&
    !isCurrentUser &&
    Boolean(accountId) &&
    (await database.getActorsForAccount({ accountId: accountId! })).some(
      (accountActor) =>
        accountActor.id === person.id && !accountActor.deletionStatus
    )

  // The avatar's saved description is the image's alt text. Only a local
  // profile has one; it is the active actor's own settings when that is the
  // profile shown (already read above).
  const avatarDescription = isInternalAccount
    ? (isCurrentUser
        ? actorSettings
        : await database.getActorSettings({ actorId: person.id })
      )?.avatarDescription?.trim()
    : undefined

  const initials = getInitials(person.name || '', person.preferredUsername)
  // The full `@user@domain`, qualified with the domain this profile was
  // resolved under — the one in the URL, which is the actor's own domain on a
  // multi-domain instance — and spelled the way the follower and following
  // links below and the relationship actions' `targetHandle` already are.
  const profileHandle = `@${person.preferredUsername}@${actorDomain}`

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
    if (typeof person.image === 'string') {
      return { url: person.image, mediaType: null }
    }
    const imgObj = Array.isArray(person.image) ? person.image[0] : person.image
    if (!imgObj) return null
    if (typeof imgObj === 'string') {
      return { url: imgObj, mediaType: null }
    }
    if (typeof imgObj === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const image = imgObj as any
      const url =
        typeof image.url === 'string'
          ? image.url
          : typeof image.href === 'string'
            ? image.href
            : null
      if (url) {
        return {
          url,
          mediaType:
            typeof image.mediaType === 'string' ? image.mediaType : null
        }
      }
    }
    return null
  }

  const getIconImage = () => {
    if (!person.icon) return null
    if (typeof person.icon === 'string') return person.icon
    const iconObj = Array.isArray(person.icon) ? person.icon[0] : person.icon
    if (!iconObj) return null
    if (typeof iconObj === 'string') return iconObj
    if (typeof iconObj === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const image = iconObj as any
      const url =
        typeof image.url === 'string'
          ? image.url
          : typeof image.href === 'string'
            ? image.href
            : null
      if (url) return url
    }
    return null
  }

  const headerImage = getHeaderImage()
  const headerImageUrl = headerImage?.url ?? null
  const headerImageMediaType = headerImage?.mediaType ?? null
  const iconImageUrl = getIconImage()
  const rawUrl = person.url ? getUrl(person.url) : null
  const profileUrl =
    (rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : null) ||
    (/^https?:\/\//i.test(person.id) ? person.id : null) ||
    `https://${actorDomain}/@${actorUsername}`

  // A count the server does not know is left out rather than shown as zero;
  // Following and Followers open their lists.
  const profilePath = `/@${person.preferredUsername}@${actorDomain}`
  const countCells: CountCell[] = [
    statusesCount !== null
      ? { label: 'Posts', icon: FileText, count: statusesCount }
      : null,
    followingCount !== null
      ? {
          label: 'Following',
          icon: UserCheck,
          count: followingCount,
          href: `${profilePath}/following`
        }
      : null,
    followersCount !== null
      ? {
          label: 'Followers',
          icon: Users,
          count: followersCount,
          href: `${profilePath}/followers`
        }
      : null
  ].filter((cell): cell is CountCell => cell !== null)

  const formattedSoftware = serverSoftware
    ? formatServerSoftware(serverSoftware)
    : null

  return (
    // Signed in, below `md` the profile has no page bar at all: the cover runs
    // flush to the top of the viewport and full-bleed, and the menu button
    // floats over its top-left corner (fixed, so it stays put while the page
    // scrolls). Logged out, `PublicShell` keeps its top bar and the framed
    // card at every width; the trigger and full-bleed frame need the signed-in
    // layout's mobile navigation and render nothing there.
    <div className={cn('flex flex-col gap-6', isLoggedIn && 'md:pt-8')}>
      <MobileNavigationTrigger variant="floating" />
      {person.movedTo ? (
        // Below `md` the floating menu button sits fixed over the top-left
        // 16px of whatever is first, so the banner is pushed down past it
        // (the button is `size-11` at the same inset); from `md` the button
        // is gone and the wrapper adds nothing. Logged out there is a page
        // bar instead, so no clearance is needed there.
        <div
          data-testid="moved-banner-slot"
          className={
            isLoggedIn
              ? 'pt-[calc(env(safe-area-inset-top,0px)+64px)] md:pt-0'
              : undefined
          }
        >
          <ProfileMovedBanner
            acct={
              movedTarget
                ? `${movedTarget.username}@${movedTarget.domain}`
                : null
            }
            href={
              movedTarget
                ? movedTarget.account
                  ? `/@${movedTarget.username}@${movedTarget.domain}`
                  : movedTarget.id
                : null
            }
            external={Boolean(movedTarget && !movedTarget.account)}
            isOwner={isCurrentUser}
            isRedirect={movedKind === 'redirect'}
          />
        </div>
      ) : null}
      {/* The profile header is not a card: the cover, then the avatar, name,
          handle and bio on the page itself, then the counts as a stat strip
          whose cells open the lists. */}
      <section aria-label="Profile" className="flex flex-col gap-4">
        <ProfileCover>
          <ProfileHeaderImage
            actorId={person.id}
            imageUrl={headerImageUrl}
            mediaType={headerImageMediaType}
          />
        </ProfileCover>

        <div className="relative px-4">
          <Avatar className="relative -mt-14 size-20 border-4 border-background">
            <AvatarImage
              src={iconImageUrl || undefined}
              alt={avatarDescription || ''}
            />
            {/* The 4px border takes the avatar's content box down to 72px, so
                the shared 42cqw initial would come out 30px; the Avatar board
                draws the 80px monogram at 34. */}
            <AvatarFallback className="text-[34px]">{initials}</AvatarFallback>
          </Avatar>

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight break-words">
                <ActorDisplayName
                  name={person.name || person.preferredUsername}
                  tags={getActorEmojiTags(person)}
                />
                {person.movedTo ? (
                  <span className="text-info-text bg-info-surface ml-2 inline-flex items-center gap-1 rounded-full border border-info/30 px-2 py-0.5 align-middle text-xs font-medium">
                    <ArrowRightLeft className="size-3" aria-hidden="true" />
                    moved
                  </span>
                ) : null}
              </h1>
              <p className="text-sm text-muted-foreground">
                {/* `max-w-full` + a truncating, shrinkable handle: a handle
                  longer than the column ellipsizes and the icon stays in view,
                  where a plain `truncate` on the paragraph clips the whole
                  inline-flex link (icon included). */}
                <a
                  href={profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1 hover:underline hover:text-foreground"
                  title="Open profile page"
                >
                  <span className="min-w-0 truncate">{profileHandle}</span>
                  <ExternalLink className="size-3.5 shrink-0" />
                </a>
              </p>
            </div>
            {isCurrentUser ? (
              <Button variant="outline" asChild className="shrink-0">
                <Link href="/settings/profile">Edit profile</Link>
              </Button>
            ) : isOwnedInactiveProfile ? (
              <EditOwnedProfileButton
                actorId={person.id}
                handle={profileHandle}
              />
            ) : (
              <ProfileRelationshipActions
                targetActorId={person.id}
                targetHandle={`${person.preferredUsername}@${actorDomain}`}
                isLoggedIn={isLoggedIn}
                relationship={relationship}
                targetMoved={Boolean(person.movedTo)}
              />
            )}
          </div>

          <Bio summary={person.summary} tags={getActorEmojiTags(person)} />

          {/* Each value is HTML (a local actor's is formatted from its raw
              text), so both kinds go through the same sanitizer in the block.
              `verifiedAt` comes from the stored actor row. */}
          <ProfileFieldsBlock
            fields={profileFields}
            tags={getActorEmojiTags(person)}
          />

          {formattedSoftware && (
            <div className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground break-words">
              <Info className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{formattedSoftware}</span>
            </div>
          )}

          <FeaturedTagsBlock tags={featuredTags} />
        </div>

        {countCells.length > 0 && (
          <StatStrip variant="counts" columns={countCells.length as 1 | 2 | 3}>
            {countCells.map((cell) => (
              <StatCell
                key={cell.label}
                label={cell.label}
                icon={cell.icon}
                value={formatNumber(cell.count)}
                href={cell.href}
                prefetch={false}
              />
            ))}
          </StatStrip>
        )}
      </section>

      <ActorTimelines
        key={person.id}
        host={host}
        actorId={person.id}
        hasHeaderImage={Boolean(headerImageUrl)}
        currentTime={Date.now()}
        statuses={statuses}
        attachments={attachments}
        statusPagination={statusPagination}
        postLineLimit={actorSettings?.postLineLimit}
        currentActor={currentActor ? getActorProfile(currentActor) : undefined}
        isCurrentUser={isCurrentUser}
        isPixelfed={Boolean(isPixelfed)}
        isMediaService={Boolean(isMediaService ?? isMediaOnly)}
        isMediaOnly={Boolean(isMediaOnly ?? isMediaService)}
        hasFitnessData={hasFitnessData}
        gallerySubviews={gallerySubviews}
        tabVisibility={tabVisibility}
        handle={profileHandle}
        mapProvider={getPublicMapProvider()}
        isMediaUploadEnabled={Boolean(mediaStorage)}
        isInternalAccount={isInternalAccount}
      />
    </div>
  )
}

export default Page
