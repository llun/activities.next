import { Repeat2 } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

import { repostStatus, undoRepostStatus } from '@/lib/client'
import { ACTION_BUTTON_CLASS } from '@/lib/components/posts/actions/actionButtonShared'
import { ActorProfile } from '@/lib/types/domain/actor'
import {
  Status,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

interface RepostButtonProps {
  currentActor?: ActorProfile
  status: Status
}
export const RepostButton: FC<RepostButtonProps> = ({
  currentActor,
  status
}) => {
  const mainStatus =
    status.type === StatusType.enum.Announce
      ? getOriginalStatus(status)
      : status

  const [repostedStatusId, setRepostedStatusId] = useState<string | null>(
    mainStatus.actorAnnounceStatusId
  )
  const [isLoading, setIsLoading] = useState<boolean>(false)

  useEffect(() => {
    setRepostedStatusId(mainStatus.actorAnnounceStatusId)
  }, [mainStatus.actorAnnounceStatusId])

  if (!currentActor) return null
  const repostLabel = repostedStatusId ? 'Undo repost' : 'Repost'

  return (
    <button
      disabled={isLoading}
      title={repostLabel}
      aria-label={repostLabel}
      className={cn(
        ACTION_BUTTON_CLASS,
        repostedStatusId !== null ? 'text-green-500' : 'hover:text-green-500'
      )}
      onClick={async (e) => {
        e.stopPropagation()
        if (isLoading) return

        if (repostedStatusId) {
          setIsLoading(true)
          if (await undoRepostStatus({ statusId: repostedStatusId })) {
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
      <Repeat2 className="h-4 w-4" />
    </button>
  )
}
