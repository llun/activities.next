import cn from 'classnames'
import { FC, useState } from 'react'

import { repostStatus, undoRepostStatus } from '../../../client'
import { ActorProfile } from '../../../models/actor'
import { StatusData, StatusType } from '../../../models/status'
import { Button } from '../../Button'

interface RepostButtonProps {
  currentActor?: ActorProfile
  status: StatusData
  onPostReposted?: (status: StatusData) => void
}
export const RepostButton: FC<RepostButtonProps> = ({
  currentActor,
  status,
  onPostReposted
}) => {
  const mainStatus =
    status.type === StatusType.Announce ? status.originalStatus : status

  const [isLoading, setIsLoading] = useState<boolean>(false)

  if (!currentActor) return null
  return (
    <Button
      disabled={isLoading}
      variant="link"
      title="Repost"
      className={cn({ 'text-danger': mainStatus.isActorAnnounced })}
      onClick={async () => {
        if (isLoading) return

        if (mainStatus.isActorAnnounced) {
          setIsLoading(true)
          await undoRepostStatus({ statusId: mainStatus.id })
          setIsLoading(false)
          // TODO: Reload?
          return
        }
        setIsLoading(true)
        await repostStatus({ statusId: status.id })
        onPostReposted?.(status)
        // TODO: Reload?
        setIsLoading(false)
      }}
    >
      <i className="bi bi bi-repeat"></i>
    </Button>
  )
}
