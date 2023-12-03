import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import crypto from 'crypto'

import { getConfig } from '../../../../lib/config'
import { MediaStorageType } from '../../../../lib/config/mediaStorage'
import { ERROR_400, ERROR_422 } from '../../../../lib/errors'
import { AuthenticatedGuard } from '../../../../lib/guard'
import { saveMedia } from '../../../../lib/services/medias'
import { MediaSchema } from '../../../../lib/services/medias/constants'
import { saveLocalFile } from '../../../../lib/services/medias/localFile'

export const POST = AuthenticatedGuard(async (req, context) => {
  const { mediaStorage, host } = getConfig()
  if (!mediaStorage) {
    return Response.json(ERROR_400, { status: 404 })
  }

  try {
    const { storage, currentActor } = context
    const form = await req.formData()
    const media = MediaSchema.parse(Object.fromEntries(form.entries()))
    const response = await saveMedia(storage, currentActor, media)
    return Response.json(response)

    if (mediaStorage.type === MediaStorageType.LocalFile) {
      const response = await saveLocalFile(storage, currentActor, media)
      return Response.json(response)
    }

    if (mediaStorage.type === MediaStorageType.ObjectStorage) {
      const randomPrefix = crypto.randomBytes(8).toString('hex')
      const s3client = new S3Client()
      const command = new PutObjectCommand({
        Bucket: mediaStorage.bucket,
        Key: `medias/${randomPrefix}-${media.file.name}`,
        Body: 'Hello S3!'
      })
    }

    return Response.json(ERROR_422, { status: 422 })
  } catch (e) {
    const error = e as NodeJS.ErrnoException
    console.error(error.message)
    console.error(error.stack)
    return Response.json(ERROR_422, { status: 422 })
  }
})
