import cn from 'classnames'
import { FC, useEffect, useState } from 'react'

import { repostStatus, undoRepostStatus } from '@/lib/client'
import { Button } from '@/lib/components/Button'
import { ActorProfile } from '@/lib/models/actor'
import { Status, StatusType } from '@/lib/models/status'

interface RepostButtonProps {
  currentActor?: ActorProfile
  status: Status
}
export const RepostButton: FC<RepostButtonProps> = ({
  currentActor,
  status
}) => {
  const mainStatus =
    status.type === StatusType.enum.Announce ? status.originalStatus : status

  const [isReposted, setIsReposted] = useState<boolean>(
    mainStatus.actorAnnounceStatusId !== null
  )
  const [isLoading, setIsLoading] = useState<boolean>(false)

  useEffect(() => {
    setIsReposted(mainStatus.actorAnnounceStatusId !== null)
  }, [mainStatus.actorAnnounceStatusId])

  if (!currentActor) return null
  return (
    <Button
      disabled={isLoading}
      variant="link"
      title="Repost"
      className={cn({
        'text-danger': isReposted
      })}
      onClick={async () => {
        if (isLoading) return

        if (mainStatus.actorAnnounceStatusId) {
          setIsLoading(true)
          if (await undoRepostStatus({ statusId: mainStatus.id })) {
            setIsReposted(false)
          }
          setIsLoading(false)
          return
        }
        setIsLoading(true)
        if (await repostStatus({ statusId: status.id })) {
          setIsReposted(true)
        }
        setIsLoading(false)
      }}
    >
      <i className="bi bi bi-repeat"></i>
    </Button>
  )
}
