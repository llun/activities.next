import { Repeat2 } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

import { repostStatus, undoRepostStatus } from '@/lib/client'
import { ActorProfile } from '@/lib/models/actor'
import { Status, StatusType } from '@/lib/models/status'
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
    status.type === StatusType.enum.Announce ? status.originalStatus : status

  const [repostedStatusId, setRepostedStatusId] = useState<string | null>(
    mainStatus.actorAnnounceStatusId
  )
  const [isLoading, setIsLoading] = useState<boolean>(false)

  useEffect(() => {
    setRepostedStatusId(mainStatus.actorAnnounceStatusId)
  }, [mainStatus.actorAnnounceStatusId])

  if (!currentActor) return null
  return (
    <button
      disabled={isLoading}
      title="Repost"
      className={cn(
        'flex items-center gap-1.5 rounded-full px-2 py-1 text-sm transition-colors hover:bg-muted',
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
