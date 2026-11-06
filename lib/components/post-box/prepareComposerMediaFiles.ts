import {
  ACCEPTED_FILE_TYPES,
  MAX_HEIGHT,
  MAX_WIDTH
} from '@/lib/services/medias/constants'
import { PostBoxAttachment } from '@/lib/types/domain/attachment'
import { extractVideoPoster } from '@/lib/utils/extractVideoPoster'
import { resizeImage } from '@/lib/utils/resizeImage'

const MEDIA_TYPE = 'upload'

export interface PrepareComposerMediaFilesOptions {
  /** Resolved `media.maxFileSize`, checked after resizing. */
  maxMediaFileSize: number
  /** Slots left in the composer. */
  maxAttachments: number
}

export interface PrepareComposerMediaFilesResult {
  attachments: PostBoxAttachment[]
  /** Files over the size limit, after resizing. */
  oversizeFileNames: string[]
  /** Files whose type the composer cannot attach (e.g. HEIC). */
  unsupportedFileNames: string[]
  /** Files that did not fit the remaining attachment slots. */
  overLimitFileNames: string[]
}

/**
 * Turns picked or shared files into composer attachments: type filter, slot
 * cap, video poster, resize, and the size check. Shared by the media picker and
 * the Web Share Target intake so both apply the same limits.
 */
export const prepareComposerMediaFiles = async (
  files: File[],
  options: PrepareComposerMediaFilesOptions
): Promise<PrepareComposerMediaFilesResult> => {
  const unsupportedFileNames: string[] = []
  const supported: File[] = []
  for (const file of files) {
    if (ACCEPTED_FILE_TYPES.includes(file.type)) supported.push(file)
    else unsupportedFileNames.push(file.name)
  }

  const slots = Math.max(0, options.maxAttachments)
  const accepted = supported.slice(0, slots)
  const overLimitFileNames = supported.slice(accepted.length).map((f) => f.name)
  const oversizeFileNames: string[] = []

  const attachments = (
    await Promise.all(
      accepted.map(async (targetFile): Promise<PostBoxAttachment | null> => {
        const previewUrl = URL.createObjectURL(targetFile)
        let posterUrl: string | undefined
        let posterFile: File | undefined
        try {
          if (targetFile.type.startsWith('video')) {
            const extracted = await extractVideoPoster(targetFile)
            if (extracted) {
              posterFile = extracted
              posterUrl = URL.createObjectURL(extracted)
            }
          }

          const tempId = crypto.randomUUID()
          const file = await resizeImage(targetFile, MAX_WIDTH, MAX_HEIGHT, {
            keepMetadata: true
          })
          // The upload endpoint enforces the instance's resolved
          // media.maxFileSize, so reject over-cap files here rather than after
          // a full upload round trip. Checked after resizing, which is what
          // actually gets uploaded.
          if (file.size > options.maxMediaFileSize) {
            oversizeFileNames.push(targetFile.name)
            if (posterUrl?.startsWith('blob:')) {
              URL.revokeObjectURL(posterUrl)
            }
            URL.revokeObjectURL(previewUrl)
            return null
          }
          return {
            type: MEDIA_TYPE,
            id: tempId,
            mediaType: targetFile.type,
            url: previewUrl,
            posterUrl,
            posterFile,
            width: 0,
            height: 0,
            name: '',
            file
          }
        } catch {
          // Revoke the blob URL if processing fails
          if (posterUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(posterUrl)
          }
          URL.revokeObjectURL(previewUrl)
          return null
        }
      })
    )
  ).filter((attachment): attachment is PostBoxAttachment => attachment !== null)

  return {
    attachments,
    oversizeFileNames,
    unsupportedFileNames,
    overLimitFileNames
  }
}
