import Link from 'next/link'
import { FC } from 'react'

import { ActorDisplayName } from '@/lib/components/actors/ActorDisplayName'
import { FollowAction } from '@/lib/components/follow-action/follow-action'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/lib/components/ui/card'
import { ActorProfile } from '@/lib/types/domain/actor'

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

interface AuthorizeInteractionCardProps {
  actor: Pick<
    ActorProfile,
    'id' | 'username' | 'domain' | 'name' | 'iconUrl' | 'type' | 'tags'
  >
  isSelf: boolean
}

export const AuthorizeInteractionCard: FC<AuthorizeInteractionCardProps> = ({
  actor,
  isSelf
}) => {
  const handle = `@${actor.username}@${actor.domain}`
  // The headless instance actor has no profile page (it is excluded from the
  // WebFinger profile-page link for the same reason), so do not offer a link
  // that only ever 404s.
  const profileUrl = actor.type === 'Service' ? null : `/${handle}`

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">
          {isSelf ? 'This is you' : 'Follow this account'}
        </CardTitle>
        <CardDescription>
          {isSelf
            ? 'You are signed in as this account.'
            : 'You are about to follow this account from your account on this server.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        <Avatar className="h-16 w-16">
          <AvatarImage src={actor.iconUrl || undefined} />
          <AvatarFallback>
            {getInitials(actor.name || '', actor.username)}
          </AvatarFallback>
        </Avatar>
        <div className="text-center">
          {actor.name ? (
            <p className="text-lg font-semibold">
              <ActorDisplayName name={actor.name} tags={actor.tags} />
            </p>
          ) : null}
          <p className="text-muted-foreground">{handle}</p>
        </div>
      </CardContent>
      <CardFooter className="flex justify-center gap-2">
        {isSelf ? null : <FollowAction targetActorId={actor.id} isLoggedIn />}
        {profileUrl ? (
          <Button variant="outline" asChild>
            <Link href={profileUrl} prefetch={false}>
              View profile
            </Link>
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  )
}
