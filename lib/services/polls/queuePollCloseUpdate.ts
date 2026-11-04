import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import type { StatusPoll } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// Best effort: a scheduling outage must never discard a saved poll or fail
// its edit. An old expiration job after an edit sends the current Question.
export const queuePollCloseUpdate = async (
  status: StatusPoll
): Promise<void> => {
  try {
    await getQueue().publish({
      id: getHashFromString(`${status.id}#poll-closed/${status.endAt}`),
      name: SEND_UPDATE_NOTE_JOB_NAME,
      data: { actorId: status.actorId, statusId: status.id },
      delaySeconds:
        Math.max(0, Math.ceil((status.endAt - Date.now()) / 1000)) + 1
    })
  } catch (error) {
    logger.error({
      message: 'Poll expiration update could not be queued',
      statusId: status.id,
      err: toLoggableError(error)
    })
  }
}
