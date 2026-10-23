import { uploadAttachment } from '@/lib/client'
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_HEIGHT,
  MAX_WIDTH
} from '@/lib/services/medias/constants'
import { formatFileSize } from '@/lib/utils/formatFileSize'
import { resizeImage } from '@/lib/utils/resizeImage'

export type ProfileImageUpload =
  { url: string; error?: undefined } | { url?: undefined; error: string }

/**
 * Turns a picked file into the URL a profile image is saved with: checks the
 * type, resizes it, checks the size that will actually be uploaded against the
 * instance's cap (checking the original would reject a large photo that
 * resizing brings under a lowered cap) and uploads it through the same media
 * upload the composer uses (`uploadAttachment`). The profile routes only accept
 * a URL on this instance's own media path, which is what the upload answers
 * with. Never throws: a failure is an `error` message to show next to the
 * field.
 */
export const uploadProfileImage = async (
  file: File,
  maxMediaFileSize: number
): Promise<ProfileImageUpload> => {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return { error: 'Please select a JPEG or PNG image' }
  }
  try {
    const resizedFile = await resizeImage(file, MAX_WIDTH, MAX_HEIGHT)
    if (resizedFile.size > maxMediaFileSize) {
      return {
        error: `Image is too large. Maximum size is ${formatFileSize(maxMediaFileSize)}`
      }
    }
    const result = await uploadAttachment(resizedFile)
    if (!result) return { error: 'Failed to upload image. Please try again.' }
    return { url: result.url }
  } catch {
    return { error: 'Failed to upload image. Please try again.' }
  }
}
