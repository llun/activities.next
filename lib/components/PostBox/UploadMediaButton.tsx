import { FC, SyntheticEvent, useRef } from 'react'

import { uploadMedia } from '../../client'
import { UploadedAttachment } from '../../models/attachment'
import { ACCEPTED_FILE_TYPES } from '../../services/medias/constants'
import { Button } from '../Button'

interface Props {
  isMediaUploadEnabled?: boolean
  onSelectMedias: (medias: UploadedAttachment[]) => void
}

export const UploadMediaButton: FC<Props> = ({
  isMediaUploadEnabled,
  onSelectMedias
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const onOpenFile = () => {
    const input = fileInputRef.current
    if (!input) return
    input.click()
  }
  const onSelectFile = async (
    event: SyntheticEvent<HTMLInputElement, Event>
  ) => {
    if (!event.currentTarget.files) return
    if (!event.currentTarget.files.length) return

    const medias = await Promise.all(
      Array.from(event.currentTarget.files).map((file) =>
        uploadMedia({ media: file })
      )
    )
    onSelectMedias(
      medias
        .filter((media) => media)
        .map((media) => ({
          type: 'upload',
          id: media.id,
          mediaType: media.mime_type,
          url: media.url,
          posterUrl: media.preview_url,
          width: media.meta.original.width,
          height: media.meta.original.height
        }))
    )
  }

  if (!isMediaUploadEnabled) {
    return null
  }

  return (
    <>
      <input
        ref={fileInputRef}
        name="file"
        type="file"
        accept={ACCEPTED_FILE_TYPES.join(',')}
        className="d-none"
        multiple
        onChange={onSelectFile}
      />
      <Button variant="link" onClick={onOpenFile}>
        <i className="bi bi-image" />
      </Button>
    </>
  )
}
