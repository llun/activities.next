import { FC, SyntheticEvent, useRef } from 'react'

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
  const onSelectFile = (event: SyntheticEvent<HTMLInputElement, Event>) => {
    alert(event.currentTarget.value)
  }

  if (!isMediaUploadEnabled) {
    return null
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        className="d-none"
        accept="image/jpg,video/mp4,audio/mp4"
        onChange={onSelectFile}
      />
      <Button variant="link" onClick={onOpenFile}>
        <i className="bi bi-image" />
      </Button>
    </>
  )
}
