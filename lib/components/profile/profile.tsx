import { format } from 'date-fns'
import Link from 'next/link'
import { FC } from 'react'

import { cn } from '@/lib/utils'

interface Props {
  className?: string
  name: string
  username: string
  domain: string
  url: string
  totalPosts?: number
  followingCount?: number
  followersCount?: number
  createdAt: number
}

export const Profile: FC<Props> = ({
  className,
  username,
  name,
  url,
  totalPosts,
  followersCount,
  followingCount,
  createdAt
}) => (
  <div className={cn(className, 'max-w-full')}>
    <h1 className="truncate">{name}</h1>
    <h4 className="truncate">
      <Link prefetch={false} href={url} target="_blank">
        @{username}
      </Link>
    </h4>
    {totalPosts || followingCount || followersCount ? (
      <p>
        <span className="inline-block whitespace-nowrap">
          {totalPosts} Posts
        </span>
        <span className="inline-block ml-2 whitespace-nowrap">
          {followingCount} Following
        </span>
        <span className="inline-block ml-2 whitespace-nowrap">
          {followersCount} Followers
        </span>
      </p>
    ) : null}
    {Number.isInteger(createdAt) ? (
      <p>Joined {format(createdAt, 'd MMM yyyy')}</p>
    ) : null}
  </div>
)
