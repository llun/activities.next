'use client'

import { FC, useState } from 'react'

import { MediasModal } from '@/lib/components/MediasModal'
import { Post } from '@/lib/components/Posts/Post'
import { AttachmentData } from '@/lib/models/attachment'
import { StatusData } from '@/lib/models/status'

interface Props {
  host: string
  currentTime: Date
  status: StatusData
}

export const StatusBox: FC<Props> = ({ host, currentTime, status }) => {
  const [modalMedias, setModalMedias] = useState<{
    medias: AttachmentData[]
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
