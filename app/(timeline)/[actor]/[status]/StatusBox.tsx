'use client'

import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import { MediasModal } from '@/lib/components/medias-modal/medias-modal'
import { Post } from '@/lib/components/posts/post'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'

import { FitnessStatusDetail } from './FitnessStatusDetail'
import { StatusLikes } from './StatusLikes'

interface Props {
  host: string
  currentTime: Date
  currentActor?: ActorProfile | null
  status: Status
  variant?: 'detail' | 'comment'
}

export const StatusBox: FC<Props> = ({
  host,
  currentTime,
  currentActor,
  status,
  variant = 'comment'
}) => {
  const router = useRouter()
  const [modalMedias, setModalMedias] = useState<{
    medias: Attachment[]
    initialSelection: number
  } | null>(null)
  const actualStatus =
    status.type === StatusType.enum.Announce ? status.originalStatus : status
  const shouldRenderFitnessDetail =
    variant === 'detail' &&
    actualStatus.type === StatusType.enum.Note &&
    actualStatus.fitness?.processingStatus === 'completed'

  if (shouldRenderFitnessDetail) {
    return (
      <>
        <FitnessStatusDetail
          host={host}
          currentTime={currentTime}
          currentActor={currentActor}
          status={actualStatus as StatusNote}
          onShowAttachment={(allMedias, index) => {
            setModalMedias({ medias: allMedias, initialSelection: index })
          }}
        />
        <MediasModal
          medias={modalMedias?.medias ?? null}
          initialSelection={modalMedias?.initialSelection ?? 0}
          onClosed={() => setModalMedias(null)}
        />
      </>
    )
  }

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
