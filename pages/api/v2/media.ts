import formidable from 'formidable'
import sharp from 'sharp'
import z from 'zod'

import { getConfig } from '../../../lib/config'
import { errorResponse } from '../../../lib/errors'
import { ApiGuard } from '../../../lib/guard'
import { ApiTrace } from '../../../lib/trace'

const FormidableFile = z.object({
  filepath: z.string(),
  originalFilename: z.string(),
  size: z.number()
})

export const MediaSchema = z.object({
  file: FormidableFile,
  thumbnail: FormidableFile.optional(),
  description: z.string().optional()
})

export const config = {
  api: {
    bodyParser: false
  }
}

const handler = ApiTrace(
  'v2/media',
  ApiGuard(async (req, res, context) => {
    const { storage, currentActor } = context
    const config = getConfig()
    switch (req.method) {
      case 'POST': {
        if (!config.mediaStorage) {
          return errorResponse(res, 500)
        }
        try {
          const form = formidable({
            allowEmptyFiles: true,
            minFileSize: 0
          })
          const [fields, files] = await form.parse(req)
          const combined = {
            ...Object.keys(fields).reduce((out, field) => {
              const values = fields[field]
              const value = (Array.isArray(values) ? values : [values])
                .filter((item) => item.length > 0)
                .shift()
              return {
                ...out,
                ...(value && { [field]: value })
              }
            }, {}),
            ...Object.keys(files).reduce((out, file) => {
              const values = files[file]
              const value = (Array.isArray(values) ? values : [values])
                .filter((item) => item.size > 0)
                .shift()
              return {
                ...out,
                ...(value && { [file]: value })
              }
            }, {})
          }
          const parsedInput = MediaSchema.parse(combined)
          const originalMetaData = await sharp(
            parsedInput.file.filepath
          ).metadata()

          const thumbnailMetaData = parsedInput.thumbnail
            ? await sharp(parsedInput.thumbnail.filepath).metadata()
            : null

          const media = await storage.createMedia({
            actorId: currentActor.id,
            original: {
              path: parsedInput.file.filepath,
              bytes: originalMetaData.size ?? 0,
              mimeType: `image/${originalMetaData.format}`,
              metaData: {
                width: originalMetaData.width ?? 0,
                height: originalMetaData.height ?? 0
              }
            },
            ...(parsedInput.thumbnail
              ? {
                  thumbnail: {
                    path: parsedInput.thumbnail.filepath,
                    bytes: thumbnailMetaData?.size ?? 0,
                    mimeType: `image/${thumbnailMetaData?.format}`,
                    metaData: {
                      width: thumbnailMetaData?.width ?? 0,
                      height: thumbnailMetaData?.height ?? 0
                    }
                  }
                }
              : null),
            ...(parsedInput.description
              ? { description: parsedInput.description }
              : null)
          })

          if (!media) {
            return errorResponse(res, 422)
          }
          // TODO: Fix FS path
          // TODO: Fix FS filename
          // TODO: Upload file to Object Storage
          console.log(media)

          res.status(200).json({
            id: 1,
            type: 'image',
            url: '',
            preview_url: '',
            text_url: '',
            remote_Url: '',
            meta: {
              original: {
                width: media.original.metaData.width,
                height: media.original.metaData.height,
                size: `${media.original.metaData.width}x${media.original.metaData.height}`,
                aspect:
                  media.original.metaData.width / media.original.metaData.height
              },
              ...(media.thumbnail
                ? {
                    small: {
                      width: media.thumbnail.metaData.width,
                      height: media.thumbnail.metaData.height,
                      size: `${media.thumbnail.metaData.width}x${media.thumbnail.metaData.height}`,
                      aspect:
                        media.thumbnail.metaData.width /
                        media.thumbnail.metaData.height
                    }
                  }
                : null)
            },
            description: media?.description ?? ''
          })
        } catch {
          return errorResponse(res, 422)
        }

        return
      }
      default: {
        return errorResponse(res, 404)
      }
    }
  })
)

export default handler
