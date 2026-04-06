'use client'

import { Posts } from '@/lib/components/posts/posts'
import { Status } from '@/lib/types/domain/status'

interface Props {
  host: string
  statuses: Status[]
  currentTime: number
}

export const AdminHashtagPosts = ({ host, statuses, currentTime }: Props) => (
  <Posts
    host={host}
    currentTime={new Date(currentTime)}
    statuses={statuses}
    showActions={false}
  />
)
