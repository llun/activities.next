'use client'

import { FC, useState } from 'react'

import { MediasModal } from '@/lib/components/MediasModal'
import { Post } from '@/lib/components/Posts/Post'
import { Attachment } from '@/lib/models/attachment'
import { Status } from '@/lib/models/status'

interface Props {
  host: string
  currentTime: Date
  status: Status
}

export const StatusBox: FC<Props> = ({ host, currentTime, status }) => {
  const [modalMedias, setModalMedias] = useState<{
    medias: Attachment[]
    initialSelection: number
  } | null>(null)

  return (
    <>
      <Post
        host={host}
        currentTime={currentTime}
        status={status}
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
