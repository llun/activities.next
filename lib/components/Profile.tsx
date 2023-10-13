import cn from 'classnames'
import format from 'date-fns/format'
import Link from 'next/link'
import { FC } from 'react'

import styles from './Profile.module.scss'

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
  <div className={cn(className, styles.profile)}>
    <h1 className="text-truncate">{name}</h1>
    <h4 className="text-truncate">
      <Link prefetch={false} href={url} target="_blank">
        @{username}
      </Link>
    </h4>
    {totalPosts || followingCount || followersCount ? (
      <p>
        <span className="d-inline-block text-nowrap">{totalPosts} Posts</span>
        <span className="d-inline-block ms-2 text-nowrap">
          {followingCount} Following
        </span>
        <span className="d-inline-block ms-2 text-nowrap">
          {followersCount} Followers
        </span>
      </p>
    ) : null}
    {Number.isInteger(createdAt) ? (
      <p>Joined {format(createdAt, 'd MMM yyyy')}</p>
    ) : null}
  </div>
)
