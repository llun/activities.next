import type { NextApiHandler } from 'next'
import { getStorage } from '../../lib/storage'
import { fromJson } from '../../lib/models/status'
import { activitiesGuard } from '../../lib/guard'
import { ERROR_404 } from '../../lib/errors'
import { StatusActivity } from '../../lib/activities/actions/status'

const ApiHandler: NextApiHandler = activitiesGuard(
  async (req, res) => {
    const body = JSON.parse(req.body) as StatusActivity
    const storage = await getStorage()
    switch (body.type) {
      case 'Create': {
        storage?.createStatus({ status: fromJson(body.object) })
        return res.status(202).send('')
      }
      default:
        return res.status(404).send(ERROR_404)
    }
  },
  ['POST']
)

export default ApiHandler
