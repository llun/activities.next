'use client'

import { FC, useState } from 'react'

import { Modal } from '@/lib/components/Modal'
import { Media } from '@/lib/components/Posts/Media'
import { Post } from '@/lib/components/Posts/Post'
import { AttachmentData } from '@/lib/models/attachment'
import { StatusData } from '@/lib/models/status'

interface Props {
  currentTime: Date
  status: StatusData
}

export const StatusBox: FC<Props> = ({ currentTime, status }) => {
  const [modalMedia, setModalMedia] = useState<AttachmentData>()

  return (
    <>
      <Post
        currentTime={currentTime}
        status={status}
        onShowAttachment={(attachment: AttachmentData) =>
          setModalMedia(attachment)
        }
      />
      <Modal
        isOpen={Boolean(modalMedia)}
        onRequestClose={() => setModalMedia(undefined)}
      >
        <Media showVideoControl attachment={modalMedia} />
      </Modal>
    </>
  )
}
