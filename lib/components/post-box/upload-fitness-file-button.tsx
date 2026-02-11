import { Activity } from 'lucide-react'
import { FC, SyntheticEvent, useRef } from 'react'

import { Button } from '@/lib/components/ui/button'

import { ACCEPTED_FITNESS_FILE_EXTENSIONS } from '../../services/fitness-files/constants'

interface Props {
  disabled?: boolean
  onFileSelected: (file: File) => void
  onError: (message: string) => void
}

export const UploadFitnessFileButton: FC<Props> = ({
  disabled,
  onFileSelected,
  onError
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
    const extension = file.name.toLowerCase().split('.').pop()

    if (
      !extension ||
      !ACCEPTED_FITNESS_FILE_EXTENSIONS.includes(`.${extension}`)
    ) {
      onError(
        `Invalid file type. Please upload ${ACCEPTED_FITNESS_FILE_EXTENSIONS.join(', ')} files only.`
      )
      return
    }

    onFileSelected(file)
    // Reset input so the same file can be selected again
    event.currentTarget.value = ''
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={ACCEPTED_FITNESS_FILE_EXTENSIONS.join(',')}
        onChange={onSelectFile}
      />
      <Button
        type="button"
        variant="link"
        onClick={onOpenFile}
        disabled={disabled}
        title="Upload fitness activity file (.fit, .gpx, .tcx)"
      >
        <Activity className="size-4" />
      </Button>
    </>
  )
}
