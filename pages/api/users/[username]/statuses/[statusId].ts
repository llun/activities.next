import type { NextApiRequest, NextApiResponse } from 'next'

import { Note } from '../../../../../lib/activities/entities/note'
import { getConfig } from '../../../../../lib/config'
import { ERROR_404, ERROR_500 } from '../../../../../lib/errors'
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
  const config = getConfig()
  const storage = await getStorage()
  if (!storage) {
    return res.status(500).json(ERROR_500)
  }

  const { username, statusId } = req.query
  const id = `https://${config.host}/users/${username}/statuses/${statusId}`
  const status = await storage.getStatus({ statusId: id })
  if (!status) {
    return res.status(404).json(ERROR_404)
  }

  const note = status.toObject()
  if (!note) {
    return res.status(404).json(ERROR_404)
  }

  res.status(200).json({
    '@context': ACTIVITY_STREAM_URL,
    ...note
  })
}
