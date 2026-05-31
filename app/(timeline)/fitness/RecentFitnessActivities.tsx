import { FC } from 'react'

import { Posts } from '@/lib/components/posts/posts'
import { Status } from '@/lib/types/domain/status'

interface Props {
  host: string
  currentTime: number
  statuses: Status[]
}

export const RecentFitnessActivities: FC<Props> = ({
  host,
  currentTime,
  statuses
}) => {
  if (statuses.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="text-base font-medium">Recent activities</h2>
      <Posts host={host} currentTime={currentTime} statuses={statuses} />
    </section>
  )
}
