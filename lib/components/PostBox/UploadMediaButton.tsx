import { FC, SyntheticEvent, useRef } from 'react'

import { uploadMedias } from '../../client'
import { Button } from '../Button'

interface Props {
  isMediaUploadEnabled?: boolean
}

export const UploadMediaButton: FC<Props> = ({ isMediaUploadEnabled }) => {
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

    await uploadMedias({ medias: event.currentTarget.files })
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
        accept="image/jpg,image/png,video/mp4,audio/mp4"
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
