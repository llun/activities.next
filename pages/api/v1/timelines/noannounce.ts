import { ERROR_404 } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'
import { Timeline } from '../../../../lib/timelines/types'

const getFirstValueFromQuery = <T>(value?: T | T[]) => {
  if (Array.isArray(value)) return value[0]
  return value
}

const handler = ApiGuard(async (req, res, context) => {
  const { storage, currentActor } = context
  const { startAfterStatusId } = req.query
  switch (req.method) {
    case 'GET': {
      const statuses = await storage.getTimeline({
        timeline: Timeline.NOANNOUNCE,
        actorId: currentActor.id,
        startAfterStatusId: getFirstValueFromQuery(startAfterStatusId)
      })
      res.status(200).json({ statuses: statuses.map((item) => item.toJson()) })
      return
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
})
export default handler
