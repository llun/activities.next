import { FileUp } from 'lucide-react'
import { FC, SyntheticEvent, useRef } from 'react'

import { Button } from '@/lib/components/ui/button'

interface Props {
  isMediaUploadEnabled?: boolean
  fitFile: File | null
  onSelectFitFile: (file: File) => void
  onDuplicateError: () => void
  onInvalidFileError: () => void
}

const FIT_FILE_ACCEPT = '.fit,application/octet-stream,application/vnd.ant.fit'

const isFitFile = (file: File): boolean => {
  return file.name.toLowerCase().endsWith('.fit')
}

export const UploadFitButton: FC<Props> = ({
  isMediaUploadEnabled,
  fitFile,
  onSelectFitFile,
  onDuplicateError,
  onInvalidFileError
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const onOpenFile = () => {
    fileInputRef.current?.click()
  }

  const onSelectFile = (event: SyntheticEvent<HTMLInputElement, Event>) => {
    const selectedFile = event.currentTarget.files?.[0]
    if (!selectedFile) return

    if (!isFitFile(selectedFile)) {
      onInvalidFileError()
      event.currentTarget.value = ''
      return
    }

    if (fitFile && fitFile.name === selectedFile.name) {
      onDuplicateError()
      event.currentTarget.value = ''
      return
    }

    onSelectFitFile(selectedFile)
    event.currentTarget.value = ''
  }

  if (!isMediaUploadEnabled) return null

  return (
    <>
      <input
        ref={fileInputRef}
        name="fit-file"
        type="file"
        accept={FIT_FILE_ACCEPT}
        className="hidden"
        onChange={onSelectFile}
      />
      <Button
        type="button"
        variant="ghost"
        onClick={onOpenFile}
        className="gap-2 text-foreground hover:text-foreground"
      >
        <FileUp className="size-4" />
        <span className="text-sm">Add FIT</span>
        <span className="text-sm text-muted-foreground">
          {fitFile ? '1/1' : '0/1'}
        </span>
      </Button>
    </>
  )
}
