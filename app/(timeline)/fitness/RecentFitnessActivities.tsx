import { FC } from 'react'

import { Posts } from '@/lib/components/posts/posts'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'

interface Props {
  host: string
  currentTime: number
  currentActor: ActorProfile
  statuses: Status[]
}

export const RecentFitnessActivities: FC<Props> = ({
  host,
  currentTime,
  currentActor,
  statuses
}) => {
  if (statuses.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="text-base font-medium">Recent activities</h2>
      {/* `currentActor` without `showActions` deliberately: this stays a
          read-only list (`Posts` gates the action row on both), but `Post` needs
          the viewer to tell that these are the signed-in actor's OWN activities
          and offer the source-file download. Every status here comes from
          `getFitnessFilesByActor({ actorId: currentActor.id })`, so the owner is
          the only person who ever sees this page — without the prop they were
          the one viewer denied a link the endpoint would happily serve them. */}
      <Posts
        host={host}
        currentTime={currentTime}
        currentActor={currentActor}
        statuses={statuses}
      />
    </section>
  )
}
