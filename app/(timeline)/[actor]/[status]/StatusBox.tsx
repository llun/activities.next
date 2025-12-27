'use client'

import { FC, useState } from 'react'
import { useRouter } from 'next/navigation'

import { MediasModal } from '@/lib/components/medias-modal/medias-modal'
import { Post } from '@/lib/components/posts/post'
import { Attachment } from '@/lib/models/attachment'
import { Status } from '@/lib/models/status'
import { cn } from '@/lib/utils'
import { getStatusDetailPath } from '@/lib/utils/getStatusDetailPath'

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
          const detailPath = getStatusDetailPath(status)
          if (detailPath) router.push(detailPath)
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
