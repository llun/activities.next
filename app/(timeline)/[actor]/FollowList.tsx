'use client'

import Link from 'next/link'
import { FC } from 'react'

import { FollowAction } from '@/lib/components/follow-action/follow-action'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { ActorProfile } from '@/lib/models/actor'

interface Props {
  users: ActorProfile[]
  isLoggedIn: boolean
}

export const FollowList: FC<Props> = ({ users, isLoggedIn }) => {
  return (
    <div className="divide-y">
      {users.map((user) => {
        const initials = (user.name || '')
          .split(' ')
          .map((n) => n[0])
          .join('')
          .toUpperCase()

        return (
          <div key={user.id} className="flex items-center gap-3 px-5 py-4">
            <Link href={`/@${user.username}@${user.domain}`}>
              <Avatar className="h-12 w-12">
                <AvatarImage src={user.iconUrl} />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            </Link>

            <div className="min-w-0 flex-1">
              <Link
                href={`/@${user.username}@${user.domain}`}
                className="block truncate font-semibold hover:underline"
              >
                {user.name}
              </Link>
              <div className="truncate text-sm text-muted-foreground">
                @{user.username}@{user.domain}
              </div>
              <div className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                {user.summary}
              </div>
            </div>

            <FollowAction targetActorId={user.id} isLoggedIn={isLoggedIn} />
          </div>
        )
      })}
    </div>
  )
}
