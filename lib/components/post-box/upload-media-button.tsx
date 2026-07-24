import { ImagePlus } from 'lucide-react'
import { FC, SyntheticEvent, useRef } from 'react'

import { useInstanceLimits } from '@/lib/components/instance-limits'
import { Button } from '@/lib/components/ui/button'
import {
  ACCEPTED_FILE_TYPES,
  MAX_ATTACHMENTS,
  MAX_HEIGHT,
  MAX_WIDTH
} from '@/lib/services/medias/constants'
import { PostBoxAttachment } from '@/lib/types/domain/attachment'
import { formatFileSize } from '@/lib/utils/formatFileSize'
import { logger } from '@/lib/utils/logger'
import { resizeImage } from '@/lib/utils/resizeImage'

const MEDIA_TYPE = 'upload'

interface Props {
  isMediaUploadEnabled?: boolean
  attachments?: PostBoxAttachment[]
  onAddAttachment: (attachment: PostBoxAttachment) => void
  onDuplicateError: () => void
  /** Reports files rejected before upload (currently: over the size cap). */
  onFileRejected?: (message: string) => void
  onUploadStart: () => void
  onBeforeAddAttachments?: () => boolean | void | Promise<boolean | void>
}

export const UploadMediaButton: FC<Props> = ({
  isMediaUploadEnabled,
  attachments = [],
  onAddAttachment,
  onDuplicateError,
  onFileRejected,
  onUploadStart,
  onBeforeAddAttachments
}) => {
  const { maxMediaFileSize } = useInstanceLimits()
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

    const selectedFiles = Array.from(event.currentTarget.files)
    onUploadStart()

    const availableSlots = MAX_ATTACHMENTS - attachments.length
    if (availableSlots <= 0) return

    const filteredFiles = selectedFiles.filter((file) => {
      return !attachments.some((attachment) => attachment.name === file.name)
    })

    if (filteredFiles.length !== selectedFiles.length) {
      onDuplicateError()
    }

    const files = filteredFiles.slice(0, availableSlots)

    const processedAttachments = (
      await Promise.all(
        files.map(async (targetFile): Promise<PostBoxAttachment | null> => {
          const previewUrl = URL.createObjectURL(targetFile)
          try {
            const tempId = crypto.randomUUID()
            const file = await resizeImage(targetFile, MAX_WIDTH, MAX_HEIGHT)
            // The upload endpoint enforces the instance's resolved
            // media.maxFileSize, so reject over-cap files here rather than
            // after a full upload round trip. Checked after resizing, which is
            // what actually gets uploaded.
            if (file.size > maxMediaFileSize) {
              onFileRejected?.(
                `${targetFile.name} is larger than the ${formatFileSize(maxMediaFileSize)} upload limit`
              )
              URL.revokeObjectURL(previewUrl)
              return null
            }
            return {
              type: MEDIA_TYPE,
              id: tempId,
              mediaType: targetFile.type,
              url: previewUrl,
              width: 0,
              height: 0,
              name: targetFile.name,
              file
            }
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
            return null
          }
        })
      )
    ).filter(
      (attachment): attachment is PostBoxAttachment => attachment !== null
    )

    if (!processedAttachments.length) return

    const shouldAddAttachments = await onBeforeAddAttachments?.()
    if (shouldAddAttachments === false) {
      processedAttachments.forEach((attachment) => {
        if (attachment.url.startsWith('blob:')) {
          URL.revokeObjectURL(attachment.url)
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
        onChange={onSelectFile}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onOpenFile}
        disabled={attachments.length >= MAX_ATTACHMENTS}
        className="text-muted-foreground hover:text-foreground"
        aria-label={`Add media (${attachments.length}/${MAX_ATTACHMENTS})`}
        title={`Add media (${attachments.length}/${MAX_ATTACHMENTS})`}
      >
        <ImagePlus className="size-4" />
      </Button>
    </>
  )
}
