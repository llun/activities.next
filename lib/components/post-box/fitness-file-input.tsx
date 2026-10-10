import { FC, Ref, SyntheticEvent, useImperativeHandle, useRef } from 'react'

import { ACCEPTED_FITNESS_FILE_EXTENSIONS } from '@/lib/services/fitness-files/constants'

export interface FitnessFileInputHandle {
  /** Opens the browser's file picker, as if the hidden input was clicked. */
  open: () => void
}

interface Props {
  ref?: Ref<FitnessFileInputHandle>
  onFileSelected: (file: File) => void
  onError: (message: string) => void
}

/**
 * The hidden file input behind the composer's "Fitness file" menu item. It has
 * no visible control of its own: the menu item calls `ref.current.open()`, and
 * this component keeps the extension validation and its error message, so the
 * input can stay mounted while the menu (and the item) comes and goes.
 */
export const FitnessFileInput: FC<Props> = ({
  ref,
  onFileSelected,
  onError
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    open: () => fileInputRef.current?.click()
  }))

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
    <input
      ref={fileInputRef}
      type="file"
      className="hidden"
      accept={ACCEPTED_FITNESS_FILE_EXTENSIONS.join(',')}
      aria-label="Fitness activity file"
      tabIndex={-1}
      onChange={onSelectFile}
    />
  )
}
