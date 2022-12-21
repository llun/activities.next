import format from 'date-fns/format'
import Link from 'next/link'
import { FC } from 'react'

import { getAtWithHostFromId } from '../models/actor'

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
        {getAtWithHostFromId(id)}
      </Link>
    </h4>
    <p>
      <span>{totalPosts} Posts</span>
      <span className="ms-2">{followingCount} Following</span>
      <span className="ms-2">{followersCount} Followers</span>
    </p>
    {Number.isInteger(createdAt) && (
      <p>Joined {format(createdAt, 'd MMM yyyy')}</p>
    )}
  </div>
)
