import { FC, SyntheticEvent, useRef } from 'react'
import { ImagePlus } from 'lucide-react'

import { resizeImage } from '@/lib/utils/resizeImage'

import {
  createUploadPresignedUrl,
  uploadFileToPresignedUrl,
  uploadMedia
} from '../../client'
import { PostBoxAttachment } from '../../models/attachment'
import {
  ACCEPTED_FILE_TYPES,
  MAX_ATTACHMENTS,
  MAX_HEIGHT,
  MAX_WIDTH
} from '../../services/medias/constants'

import { Button } from '@/lib/components/ui/button'

const MEDIA_TYPE = 'upload'

interface Props {
  isMediaUploadEnabled?: boolean
  attachments?: PostBoxAttachment[]
  onAddAttachment: (attachment: PostBoxAttachment) => void
  onUpdateAttachment: (id: string, attachment: PostBoxAttachment) => void
  onRemoveAttachment: (id: string) => void
  onDuplicateError: () => void
}

export const UploadMediaButton: FC<Props> = ({
  isMediaUploadEnabled,
  attachments = [],
  onAddAttachment,
  onUpdateAttachment,
  onRemoveAttachment,
  onDuplicateError
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

    const files = Array.from(event.currentTarget.files).filter((file) => {
      return !attachments.some((attachment) => attachment.name === file.name)
    })

    if (files.length !== event.currentTarget.files.length) {
      onDuplicateError()
    }

    files.map(async (targetFile) => {
      const tempId = crypto.randomUUID()
      const previewUrl = URL.createObjectURL(targetFile)
      const file = await resizeImage(targetFile, MAX_WIDTH, MAX_HEIGHT)
      onAddAttachment({
        type: MEDIA_TYPE,
        id: tempId,
        mediaType: targetFile.type,
        url: previewUrl,
        width: 0,
        height: 0,
        name: targetFile.name,
        isLoading: true
      })

      try {
        const result = await createUploadPresignedUrl({ media: file })
        if (!result) {
          const media = await uploadMedia({ media: file })
          if (!media) {
            onRemoveAttachment(tempId)
            window.alert(`Fail to upload ${targetFile.name}`)
            return
          }
          onUpdateAttachment(tempId, {
            type: MEDIA_TYPE,
            id: media.id,
            mediaType: media.mime_type,
            url: media.url,
            posterUrl: media.preview_url,
            width: media.meta.original.width,
            height: media.meta.original.height,
            isLoading: false
          })
          return
        }

        const { url: presignedUrl, fields, saveFileOutput } = result.presigned
        await uploadFileToPresignedUrl({
          media: file,
          presignedUrl,
          fields
        })
        onUpdateAttachment(tempId, {
          type: MEDIA_TYPE,
          id: saveFileOutput.id,
          mediaType: saveFileOutput.mime_type,
          url: saveFileOutput.url,
          width: saveFileOutput.meta.original.width,
          height: saveFileOutput.meta.original.height,
          isLoading: false
        })
      } catch (_error) {
        onRemoveAttachment(tempId)
        window.alert(`Fail to upload ${targetFile.name}`)
      }
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
