'use client'

import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import { MediasModal } from '@/lib/components/medias-modal/medias-modal'
import { Post } from '@/lib/components/posts/post'
import { StatusActivityData } from '@/lib/services/fitness/activityData'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status, StatusType } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'

import { FitnessActivityDetail } from './FitnessActivityDetail'
import { StatusLikes } from './StatusLikes'

interface Props {
  host: string
  currentTime: Date
  currentActor?: ActorProfile | null
  status: Status
  activity?: StatusActivityData | null
  variant?: 'detail' | 'comment'
}

export const StatusBox: FC<Props> = ({
  host,
  currentTime,
  currentActor,
  status,
  activity,
  variant = 'comment'
}) => {
  const router = useRouter()
  const [modalMedias, setModalMedias] = useState<{
    medias: Attachment[]
    initialSelection: number
  } | null>(null)
  const actualStatus =
    status.type === StatusType.enum.Announce ? status.originalStatus : status

  return (
    <>
      <article
        className={cn(
          'p-4 transition-colors',
          variant === 'comment' && 'cursor-pointer hover:bg-muted/40'
        )}
        onClick={() => {
          if (variant === 'detail') return
          void (async () => {
            const detailPath = await getStatusDetailPathClient(status)
            if (detailPath) router.push(detailPath)
          })()
        }}
      >
        {variant === 'detail' && activity ? (
          <FitnessActivityDetail
            host={host}
            currentTime={currentTime}
            currentActor={currentActor}
            status={status}
            activity={activity}
            onShowAttachment={(allMedias, index) => {
              setModalMedias({ medias: allMedias, initialSelection: index })
            }}
          />
        ) : (
          <Post
            host={host}
            currentActor={currentActor ?? undefined}
            currentTime={currentTime}
            status={status}
            showActions={variant === 'detail'}
            onShowAttachment={(allMedias, index) => {
              setModalMedias({ medias: allMedias, initialSelection: index })
            }}
          />
        )}
        {variant === 'detail' && (
          <StatusLikes
            statusId={actualStatus.id}
            totalLikes={actualStatus.totalLikes}
          />
        )}
      </article>
      <MediasModal
        medias={modalMedias?.medias ?? null}
        initialSelection={modalMedias?.initialSelection ?? 0}
        onClosed={() => setModalMedias(null)}
      />
    </>
  )
}
