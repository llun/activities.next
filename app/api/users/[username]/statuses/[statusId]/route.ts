import { type NextRequest } from 'next/server'

import { ERROR_404, ERROR_500 } from '../../../../../../lib/errors'
import { headerHost } from '../../../../../../lib/guard'
import { ACTIVITY_STREAM_URL } from '../../../../../../lib/jsonld/activitystream'
import { getStorage } from '../../../../../../lib/storage'

interface Segments {
  params: {
    username: string
    statusId: string
  }
}

export const GET = async (req: NextRequest, segments: Segments) => {
  const storage = await getStorage()
  if (!storage) {
    return Response.json(ERROR_500, {
      status: 500
    })
  }

  const { username, statusId } = segments.params

  const host = headerHost(req.headers)
  const id = `https://${host}/users/${username}/statuses/${statusId}`
  const status = await storage.getStatus({ statusId: id, withReplies: true })
  if (!status) {
    return Response.json(ERROR_404, { status: 404 })
  }

  const note = status.toObject()
  if (!note) {
    return Response.json(ERROR_404, { status: 404 })
  }

  return Response.json({ '@context': ACTIVITY_STREAM_URL, ...note })
}
