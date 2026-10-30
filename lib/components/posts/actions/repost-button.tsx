import { Repeat2 } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

import { repostStatus, undoRepostStatus } from '@/lib/client'
import {
  ACTION_BUTTON_CLASS,
  ActionButtonError,
  OFFLINE_MESSAGE,
  OfflineTooltip,
  useDismissingError,
  useIsOffline
} from '@/lib/components/posts/actions/actionButtonShared'
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
  /** Names the post when the row's buttons act on different ones. */
  targetLabel?: string
}
export const RepostButton: FC<RepostButtonProps> = ({
  currentActor,
  status,
  targetLabel
}) => {
  const mainStatus =
    status.type === StatusType.enum.Announce
      ? getOriginalStatus(status)
      : status

  const [repostedStatusId, setRepostedStatusId] = useState<string | null>(
    mainStatus.actorAnnounceStatusId
  )
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useDismissingError()
  const offline = useIsOffline()

  useEffect(() => {
    setRepostedStatusId(mainStatus.actorAnnounceStatusId)
    setError(null)
  }, [mainStatus.actorAnnounceStatusId, setError])

  if (!currentActor) return null
  const repostLabel = targetLabel
    ? `${repostedStatusId ? 'Undo repost of' : 'Repost'} ${targetLabel}`
    : repostedStatusId
      ? 'Undo repost'
      : 'Repost'
  const failureMessage = 'Failed to repost. Please try again.'
  const undoFailureMessage = 'Failed to undo repost. Please try again.'

  return (
    <span className="relative inline-flex items-center justify-center">
      <OfflineTooltip offline={offline}>
        <button
          aria-disabled={offline || undefined}
          disabled={isLoading}
          title={offline ? undefined : repostLabel}
          aria-label={repostLabel}
          className={cn(
            ACTION_BUTTON_CLASS,
            repostedStatusId !== null
              ? 'text-repost-icon'
              : 'hover:text-repost-icon'
          )}
          onClick={async (e) => {
            e.stopPropagation()
            if (isLoading) return
            if (offline) {
              setError(OFFLINE_MESSAGE)
              return
            }
            setError(null)

            if (repostedStatusId) {
              setIsLoading(true)
              setError(null)
              try {
                if (await undoRepostStatus({ statusId: repostedStatusId })) {
                  setRepostedStatusId(null)
                } else {
                  setError(undoFailureMessage)
                }
              } catch {
                setError(undoFailureMessage)
              } finally {
                setIsLoading(false)
              }
              return
            }
            setIsLoading(true)
            setError(null)
            try {
              const repostedStatus = await repostStatus({ statusId: status.id })
              if (repostedStatus) {
                setRepostedStatusId(repostedStatus.statusId)
              } else {
                setError(failureMessage)
              }
            } catch {
              setError(failureMessage)
            } finally {
              setIsLoading(false)
            }
          }}
        >
          <Repeat2 className="h-4 w-4" />
        </button>
      </OfflineTooltip>
      {error ? (
        <ActionButtonError message={error} testId="repost-error" />
      ) : null}
    </span>
  )
}
