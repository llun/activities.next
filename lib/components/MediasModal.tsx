import cn from 'classnames'
import { FC, useEffect, useState } from 'react'

import styles from '@/lib/components/MediasModal.module.scss'
import { Modal } from '@/lib/components/Modal'
import { Media } from '@/lib/components/Posts/Media'
import { Attachment } from '@/lib/models/attachment'

interface Props {
  medias: Attachment[] | null
  initialSelection: number
  onClosed: () => void
}

export const MediasModal: FC<Props> = ({
  medias,
  initialSelection,
  onClosed
}) => {
  const [modalSelection, setModalSelection] = useState<number>(0)
  useEffect(() => {
    setModalSelection(initialSelection)
  }, [initialSelection])

  return (
    <Modal
      className={styles.modal}
      isOpen={Boolean(medias)}
      onRequestClose={() => {
        onClosed()
        setModalSelection(0)
      }}
    >
      <div
        className={styles.mediasContent}
        onClick={() => {
          onClosed()
          setModalSelection(0)
        }}
      >
        {medias && medias.length > 1 && (
          <div className={styles.mediasSelection}>
            {medias.map((media, index) => (
              <img
                alt={media.name}
                key={media.id}
                src={media.url}
                width={50}
                height={50}
                onClick={(event) => {
                  event.stopPropagation()
                  setModalSelection(index)
                }}
              />
            ))}
          </div>
        )}
        <Media
          showVideoControl
          className={cn(styles.media)}
          attachment={medias?.[modalSelection]}
        />
      </div>
    </Modal>
  )
}
