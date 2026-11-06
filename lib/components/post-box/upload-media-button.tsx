import { ImagePlus } from 'lucide-react'
import { FC, SyntheticEvent, useRef } from 'react'

import { useInstanceLimits } from '@/lib/components/instance-limits'
import { Button } from '@/lib/components/ui/button'
import { ACCEPTED_FILE_TYPES } from '@/lib/services/medias/constants'
import { PostBoxAttachment } from '@/lib/types/domain/attachment'
import { formatFileSize } from '@/lib/utils/formatFileSize'

import { prepareComposerMediaFiles } from './prepareComposerMediaFiles'

interface Props {
  isMediaUploadEnabled?: boolean
  /** Disables picking, e.g. while the post is submitting. */
  disabled?: boolean
  attachments?: PostBoxAttachment[]
  /**
   * Original file names by attachment id. Once an upload finishes the
   * attachment drops its `file` and its `name` becomes the alt text, so the
   * names of files already picked can only be matched from here.
   */
  fileNames?: Record<string, string>
  onAddAttachment: (attachment: PostBoxAttachment) => void
  onDuplicateError: () => void
  /** Reports every file rejected before upload (currently: over the size cap). */
  onFilesRejected?: (message: string) => void
  onUploadStart: () => void
  onBeforeAddAttachments?: () => boolean | void | Promise<boolean | void>
  /**
   * Overrides the picker's slot cap. The composer passes
   * `maxMediaAttachments - 1` while a workout file is attached, because the
   * route map the fitness job adds takes the last slot.
   */
  maxAttachments?: number
}

export const UploadMediaButton: FC<Props> = ({
  isMediaUploadEnabled,
  disabled = false,
  attachments = [],
  fileNames = {},
  onAddAttachment,
  onDuplicateError,
  onFilesRejected,
  onUploadStart,
  onBeforeAddAttachments,
  maxAttachments
}) => {
  const { maxMediaFileSize, maxMediaAttachments } = useInstanceLimits()
  const attachmentCap = maxAttachments ?? maxMediaAttachments
  const fileInputRef = useRef<HTMLInputElement>(null)
  const onOpenFile = () => {
    const input = fileInputRef.current
    if (!input || disabled) return
    input.click()
  }
  const onSelectFile = async (
    event: SyntheticEvent<HTMLInputElement, Event>
  ) => {
    // Copy the (live) FileList first, then clear the input so picking the same
    // file again still fires `change` — including after an early return below.
    const input = event.currentTarget
    const selectedFiles = input.files ? Array.from(input.files) : []
    input.value = ''

    if (disabled) return
    if (!selectedFiles.length) return

    onUploadStart()

    // The instance's resolved posts.maxMediaAttachments, not a build-time
    // constant, so raising the admin setting raises the picker with it. The
    // composer lowers it by one while a workout file is attached.
    const availableSlots = attachmentCap - attachments.length
    if (availableSlots <= 0) return

    const filteredFiles = selectedFiles.filter((file) => {
      return !attachments.some(
        (attachment) =>
          (attachment.file?.name ??
            fileNames[attachment.id] ??
            attachment.name) === file.name
      )
    })

    if (filteredFiles.length !== selectedFiles.length) {
      onDuplicateError()
    }

    const {
      attachments: processedAttachments,
      oversizeFileNames,
      unsupportedFileNames
    } = await prepareComposerMediaFiles(filteredFiles, {
      maxMediaFileSize,
      maxAttachments: availableSlots
    })

    const rejected: string[] = []
    if (oversizeFileNames.length > 0) {
      rejected.push(
        `${oversizeFileNames.join(', ')} ${oversizeFileNames.length === 1 ? 'is' : 'are'} larger than the ${formatFileSize(maxMediaFileSize)} upload limit`
      )
    }
    if (unsupportedFileNames.length > 0) {
      rejected.push(
        `${unsupportedFileNames.join(', ')} ${unsupportedFileNames.length === 1 ? 'is not a supported type' : 'are not supported types'}`
      )
    }
    if (rejected.length > 0) onFilesRejected?.(rejected.join('. '))

    if (!processedAttachments.length) return

    const shouldAddAttachments = await onBeforeAddAttachments?.()
    if (shouldAddAttachments === false) {
      processedAttachments.forEach((attachment) => {
        if (attachment.url.startsWith('blob:')) {
          URL.revokeObjectURL(attachment.url)
        }
        if (attachment.posterUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(attachment.posterUrl)
        }
      })
      return
    }

    processedAttachments.forEach((attachment) => {
      onAddAttachment(attachment)
    })
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
        multiple
        accept={ACCEPTED_FILE_TYPES.join(',')}
        className="hidden"
        disabled={disabled}
        onChange={onSelectFile}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onOpenFile}
        disabled={disabled || attachments.length >= attachmentCap}
        className="size-10 text-muted-foreground hover:text-foreground md:size-8"
        aria-label={`Add media (${attachments.length}/${attachmentCap})`}
        title={`Add media (${attachments.length}/${attachmentCap})`}
      >
        <ImagePlus className="size-4" />
      </Button>
    </>
  )
}
