import cn from 'classnames'
import { FC, useState } from 'react'

import { AttachmentData } from '../models/attachment'
import styles from './MediasModal.module.scss'
import { Modal } from './Modal'
import { Media } from './Posts/Media'

interface Props {
  medias: AttachmentData[] | null
  initialSelection: number
  onClosed: () => void
}

export const MediasModal: FC<Props> = ({
  medias,
  initialSelection,
  onClosed
}) => {
  const [modalSelection, setModalSelection] = useState<number>(initialSelection)

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
