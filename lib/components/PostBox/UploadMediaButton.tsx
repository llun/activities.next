import { FC, SyntheticEvent, useRef } from 'react'

import {
  createUploadPresignedUrl,
  uploadFileToPresignedUrl,
  uploadMedia
} from '../../client'
import { UploadedAttachment } from '../../models/attachment'
import { ACCEPTED_FILE_TYPES } from '../../services/medias/constants'
import { Button } from '../Button'

const MEDIA_TYPE = 'upload'

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

    const file = event.currentTarget.files[0]
    event.currentTarget.value = ''

    const result = await createUploadPresignedUrl({ media: file })
    // No presigned supported
    if (!result) {
      const media = await uploadMedia({ media: file })
      onSelectMedias([
        {
          type: MEDIA_TYPE,
          id: media.id,
          mediaType: media.mime_type,
          url: media.url,
          posterUrl: media.preview_url,
          width: media.meta.original.width,
          height: media.meta.original.height
        }
      ])
      return
    }

    const { url: presignedUrl, fields, saveFileOutput } = result.presigned
    await uploadFileToPresignedUrl({
      media: file,
      presignedUrl,
      fields
    })
    onSelectMedias([
      {
        type: MEDIA_TYPE,
        id: saveFileOutput.id,
        mediaType: saveFileOutput.mime_type,
        url: saveFileOutput.url,
        width: saveFileOutput.meta.original.width,
        height: saveFileOutput.meta.original.height
      }
    ])
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
        onChange={onSelectFile}
      />
      <Button variant="link" onClick={onOpenFile}>
        <i className="bi bi-image" />
      </Button>
    </>
  )
}
