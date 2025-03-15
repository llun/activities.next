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

  const [repostedStatusId, setRepostedStatusId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)

  useEffect(() => {
    setRepostedStatusId(mainStatus.actorAnnounceStatusId)
  }, [mainStatus.actorAnnounceStatusId])

  if (!currentActor) return null
  return (
    <Button
      disabled={isLoading}
      variant="link"
      title="Repost"
      className={cn({
        'text-danger': repostedStatusId !== null
      })}
      onClick={async () => {
        if (isLoading) return

        if (mainStatus.actorAnnounceStatusId) {
          setIsLoading(true)
          if (
            await undoRepostStatus({
              statusId: mainStatus.actorAnnounceStatusId
            })
          ) {
            setRepostedStatusId(null)
          }
          setIsLoading(false)
          return
        }
        setIsLoading(true)
        const repostedStatus = await repostStatus({ statusId: status.id })
        if (repostedStatus) {
          setRepostedStatusId(repostedStatus.statusId)
        }
        setIsLoading(false)
      }}
    >
      <i className="bi bi bi-repeat"></i>
    </Button>
  )
}
