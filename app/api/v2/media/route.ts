import fs from 'fs/promises'
import sharp from 'sharp'
import { z } from 'zod'

import { getConfig } from '../../../../lib/config'
import { MediaStorageType } from '../../../../lib/config/mediaStorage'
import { ERROR_400, ERROR_422 } from '../../../../lib/errors'
import { AuthenticatedGuard } from '../../../../lib/guard'

// Maximum file size is 1 MB
export const MAX_FILE_SIZE = 1_048_576
export const ACCEPTED_FILE_TYPES = [
  'image/jpg',
  'image/png',
  'video/mp4',
  'audio/mp4'
]

export const FileSchema = z
  .custom<File>()
  .refine(
    (file) => file.size <= MAX_FILE_SIZE,
    `Max file size is ${MAX_FILE_SIZE} bytes.`
  )
  .refine(
    (file) => ACCEPTED_FILE_TYPES.includes(file.type),
    `Only ${ACCEPTED_FILE_TYPES.join(',')} are accepted`
  )

export const MediaSchema = z.object({
  file: FileSchema,
  thumbnail: FileSchema.optional(),
  description: z.string().optional()
})

export const POST = AuthenticatedGuard(async (req, context) => {
  const { mediaStorage, host } = getConfig()
  if (!mediaStorage) {
    return Response.json(ERROR_400, { status: 404 })
  }

  try {
    const { storage, currentActor } = context
    const form = await req.formData()
    const media = MediaSchema.parse(Object.fromEntries(form.entries()))

    if (mediaStorage.type === MediaStorageType.LocalFile) {
      const filePath = `${mediaStorage.path}/${media.file.name}`
      const thumbnailPath = media.thumbnail
        ? `${mediaStorage.path}/${media.thumbnail.name}`
        : null

      await fs.writeFile(filePath, Buffer.from(await media.file.arrayBuffer()))
      if (thumbnailPath && media.thumbnail) {
        await fs.writeFile(
          thumbnailPath,
          Buffer.from(await media.thumbnail.arrayBuffer())
        )
      }

      const originalMetaData = await sharp(filePath).metadata()
      const thumbnailMetaData = thumbnailPath
        ? await sharp(thumbnailPath).metadata()
        : null

      const storedMedia = await storage.createMedia({
        actorId: currentActor.id,
        original: {
          path: filePath,
          bytes: media.file.size,
          mimeType: media.file.type,
          metaData: {
            width: originalMetaData.width ?? 0,
            height: originalMetaData.height ?? 0
          }
        },
        ...(thumbnailPath
          ? {
              thumbnail: {
                path: thumbnailPath,
                bytes: thumbnailMetaData?.size ?? 0,
                mimeType: `image/${thumbnailMetaData?.format}`,
                metaData: {
                  width: thumbnailMetaData?.width ?? 0,
                  height: thumbnailMetaData?.height ?? 0
                }
              }
            }
          : null),
        ...(media.description ? { description: media.description } : null)
      })
      if (!storedMedia) {
        throw new Error('Fail to store media')
      }

      return Response.json({
        id: 1,
        type: media.file.type.startsWith('image') ? 'image' : 'binary',
        // TODO: Add config for base image domain?
        url: `https://${host}/api/v1/files/${storedMedia.original.path
          .split('/')
          .pop()}`,
        preview_url: '',
        text_url: '',
        remote_Url: '',
        meta: {
          original: {
            width: storedMedia.original.metaData.width,
            height: storedMedia.original.metaData.height,
            size: `${storedMedia.original.metaData.width}x${storedMedia.original.metaData.height}`,
            aspect:
              storedMedia.original.metaData.width /
              storedMedia.original.metaData.height
          },
          ...(storedMedia.thumbnail
            ? {
                small: {
                  width: storedMedia.thumbnail.metaData.width,
                  height: storedMedia.thumbnail.metaData.height,
                  size: `${storedMedia.thumbnail.metaData.width}x${storedMedia.thumbnail.metaData.height}`,
                  aspect:
                    storedMedia.thumbnail.metaData.width /
                    storedMedia.thumbnail.metaData.height
                }
              }
            : null)
        },
        description: media?.description ?? ''
      })
    }

    return Response.json(ERROR_400, { status: 400 })
  } catch {
    return Response.json(ERROR_422, { status: 422 })
  }
})
