import { FC, useEffect, useState } from 'react'

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
      className="inset-0 border-0 bg-transparent h-full"
      isOpen={Boolean(medias)}
      onRequestClose={() => {
        onClosed()
        setModalSelection(0)
      }}
    >
      <div
        className="flex flex-col h-full"
        onClick={() => {
          onClosed()
          setModalSelection(0)
        }}
      >
        {medias && medias.length > 1 && (
          <div className="flex px-8 py-4 max-md:px-2 shrink-0 gap-2 overflow-x-auto">
            {medias.map((media, index) => (
              <img
                alt={media.name}
                key={media.id}
                src={media.url}
                width={50}
                height={50}
                className="w-[3.125rem] h-[3.125rem] object-cover cursor-pointer"
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
          className="object-contain w-full h-full"
          attachment={medias?.[modalSelection]}
        />
      </div>
    </Modal>
  )
}
