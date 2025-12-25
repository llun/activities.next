'use client'

import { FC, useState } from 'react'

import { MediasModal } from '@/lib/components/MediasModal'
import { Post } from '@/lib/components/Posts/Post'
import { Attachment } from '@/lib/models/attachment'
import { getMention } from '@/lib/models/actor'
import { Status } from '@/lib/models/status'
import { cn } from '@/lib/utils'
import { getActualStatus } from '@/lib/utils/text/processStatusText'
import { useRouter } from 'next/navigation'

interface Props {
  host: string
  currentTime: Date
  status: Status
  variant?: 'detail' | 'comment'
}

export const StatusBox: FC<Props> = ({
  host,
  currentTime,
  status,
  variant = 'comment'
}) => {
  const router = useRouter()
  const [modalMedias, setModalMedias] = useState<{
    medias: Attachment[]
    initialSelection: number
  } | null>(null)

  return (
    <>
      <article
        className={cn(
          'p-4 transition-colors',
          variant === 'comment' && 'cursor-pointer hover:bg-muted/40'
        )}
        onClick={() => {
          if (variant === 'detail') return
          const actualStatus = getActualStatus(status)
          if (actualStatus.actor) {
            router.push(
              `/${getMention(actualStatus.actor, true)}/${actualStatus.id}`
            )
          }
        }}
      >
        <Post
          host={host}
          currentTime={currentTime}
          status={status}
          onShowAttachment={(allMedias, index) => {
            setModalMedias({ medias: allMedias, initialSelection: index })
          }}
        />
      </article>
      <MediasModal
        medias={modalMedias?.medias ?? null}
        initialSelection={modalMedias?.initialSelection ?? 0}
        onClosed={() => setModalMedias(null)}
      />
    </>
  )
}
