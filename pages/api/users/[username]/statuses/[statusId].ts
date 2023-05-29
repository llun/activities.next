import type { NextApiRequest, NextApiResponse } from 'next'

import { Note } from '../../../../../lib/activities/entities/note'
import { ERROR_404, ERROR_500 } from '../../../../../lib/errors'
import { headerHost } from '../../../../../lib/guard'
import { ACTIVITY_STREAM_URL } from '../../../../../lib/jsonld/activitystream'
import { getStorage } from '../../../../../lib/storage'

type Data =
  | {
      error?: string
    }
  | Note

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  const storage = await getStorage()
  if (!storage) {
    res.status(500).json(ERROR_500)
    return
  }

  const { username, statusId } = req.query

  const host = headerHost(req.headers)
  const id = `https://${host}/users/${username}/statuses/${statusId}`
  const status = await storage.getStatus({ statusId: id, withReplies: true })
  if (!status) {
    res.status(404).json(ERROR_404)
    return
  }

  const note = status.toNote()
  if (!note) {
    res.status(404).json(ERROR_404)
    return
  }

  res.status(200).json({
    '@context': ACTIVITY_STREAM_URL,
    ...note
  })
}
