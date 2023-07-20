import fs from 'fs'
import mime from 'mime-types'
import path from 'path'
import { pipeline } from 'stream/promises'

import { getConfig } from '../../../../lib/config'
import { errorResponse } from '../../../../lib/errors'
import { MediaStorageType } from '../../../../lib/storage/types/media'
import { ApiTrace } from '../../../../lib/trace'

const handler = ApiTrace('v2/files', async (req, res) => {
  const { mediaStorage } = getConfig()
  switch (req.method) {
    case 'GET': {
      if (!mediaStorage) {
        return errorResponse(res, 404)
      }

      if (mediaStorage.type !== MediaStorageType.LocalFile) {
        return errorResponse(res, 404)
      }

      const { pathname } = req.query
      if (!pathname) {
        return errorResponse(res, 404)
      }

      const filePath = path.resolve(
        mediaStorage.path,
        Array.isArray(pathname) ? pathname.join('/') : pathname
      )
      const contentType = mime.contentType(path.extname(filePath))
      if (!contentType) {
        return errorResponse(res, 500)
      }

      try {
        res.status(200)
        res.setHeader('Content-Type', contentType)
        await pipeline(fs.createReadStream(filePath), res)
        return
      } catch {
        return errorResponse(res, 500)
      }
    }
    default: {
      return errorResponse(res, 404)
    }
  }
})
export default handler
