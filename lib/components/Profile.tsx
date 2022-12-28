import format from 'date-fns/format'
import Link from 'next/link'
import { FC } from 'react'

import { getAtUsernameFromId } from '../models/actor'

interface Props {
  className?: string
  id: string
  name: string
  url: string
  totalPosts: number
  followingCount: number
  followersCount: number
  createdAt: number
}

export const Profile: FC<Props> = ({
  className,
  id,
  name,
  url,
  totalPosts,
  followersCount,
  followingCount,
  createdAt
}) => (
  <div className={className}>
    <h1>{name}</h1>
    <h4>
      <Link href={url} target={'_blank'}>
        {getAtUsernameFromId(id)}
      </Link>
    </h4>
    <p>
      <span className="d-inline-block text-nowrap">{totalPosts} Posts</span>
      <span className="d-inline-block ms-2 text-nowrap">
        {followingCount} Following
      </span>
      <span className="d-inline-block ms-2 text-nowrap">
        {followersCount} Followers
      </span>
    </p>
    {Number.isInteger(createdAt) && (
      <p>Joined {format(createdAt, 'd MMM yyyy')}</p>
    )}
  </div>
)
