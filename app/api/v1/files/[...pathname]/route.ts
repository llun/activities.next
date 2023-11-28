import fs from 'fs/promises'
import mime from 'mime-types'
import { NextRequest } from 'next/server'
import path from 'path'

import { getConfig } from '../../../../../lib/config'
import { MediaStorageType } from '../../../../../lib/config/mediaStorage'
import { ERROR_404 } from '../../../../../lib/errors'
import { AppRouterParams } from '../../../../../lib/guard'

interface Params {
  pathname: string
}

export const GET = async (
  req: NextRequest,
  params: AppRouterParams<Params>
) => {
  const { mediaStorage } = getConfig()
  if (!mediaStorage) {
    return Response.json(ERROR_404, { status: 404 })
  }

  if (mediaStorage.type !== MediaStorageType.LocalFile) {
    return Response.json(ERROR_404, { status: 404 })
  }

  const { pathname } = params.params
  const userPath = path
    .normalize(Array.isArray(pathname) ? pathname.join('/') : pathname)
    .replace(/^(\.\.(\/|\\|$))+/, '')
  const filePath = path.resolve(mediaStorage.path, userPath)
  const contentType = mime.contentType(path.extname(filePath))
  if (!contentType) {
    return Response.json(ERROR_404, { status: 404 })
  }

  try {
    const headers = new Headers([['Content-Type', contentType]])
    const buffer = await fs.readFile(filePath)
    return new Response(buffer, { headers })
  } catch {
    return Response.json(ERROR_404, { status: 404 })
  }
}
