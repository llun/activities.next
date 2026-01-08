import { ImagePlus } from 'lucide-react'
import { FC, SyntheticEvent, useRef } from 'react'

import { Button } from '@/lib/components/ui/button'
import { logger } from '@/lib/utils/logger'
import { resizeImage } from '@/lib/utils/resizeImage'

import { PostBoxAttachment } from '../../models/attachment'
import {
  ACCEPTED_FILE_TYPES,
  MAX_ATTACHMENTS,
  MAX_HEIGHT,
  MAX_WIDTH
} from '../../services/medias/constants'

const MEDIA_TYPE = 'upload'

interface Props {
  isMediaUploadEnabled?: boolean
  attachments?: PostBoxAttachment[]
  onAddAttachment: (attachment: PostBoxAttachment) => void
  onDuplicateError: () => void
  onUploadStart: () => void
}

export const UploadMediaButton: FC<Props> = ({
  isMediaUploadEnabled,
  attachments = [],
  onAddAttachment,
  onDuplicateError,
  onUploadStart
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

    onUploadStart()

    const availableSlots = MAX_ATTACHMENTS - attachments.length
    if (availableSlots <= 0) return

    const filteredFiles = Array.from(event.currentTarget.files).filter(
      (file) => {
        return !attachments.some((attachment) => attachment.name === file.name)
      }
    )

    if (filteredFiles.length !== event.currentTarget.files.length) {
      onDuplicateError()
    }

    const files = filteredFiles.slice(0, availableSlots)

    await Promise.all(
      files.map(async (targetFile) => {
        const previewUrl = URL.createObjectURL(targetFile)
        try {
          const tempId = crypto.randomUUID()
          const file = await resizeImage(targetFile, MAX_WIDTH, MAX_HEIGHT)
          onAddAttachment({
            type: MEDIA_TYPE,
            id: tempId,
            mediaType: targetFile.type,
            url: previewUrl,
            width: 0,
            height: 0,
            name: targetFile.name,
            file
          })
        } catch (error) {
          logger.error(
            {
              error,
              fileName: targetFile.name,
              fileType: targetFile.type
            },
            'Failed to process file'
          )
          // Revoke the blob URL if processing fails
          URL.revokeObjectURL(previewUrl)
        }
      })
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
        multiple
        accept={ACCEPTED_FILE_TYPES.join(',')}
        className="hidden"
        onChange={onSelectFile}
      />
      <Button
        type="button"
        variant="ghost"
        onClick={onOpenFile}
        className="gap-2 text-foreground hover:text-foreground"
      >
        <ImagePlus className="size-4" />
        <span className="text-sm">Add media</span>
        <span className="text-sm text-muted-foreground">
          {attachments.length}/{MAX_ATTACHMENTS}
        </span>
      </Button>
    </>
  )
}
