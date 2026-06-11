import { defaultJobHandle } from './base'
import { JobMessage, Queue } from './type'

export class NoQueue implements Queue {
  async publish(message: JobMessage) {
    // NoQueue runs jobs in-process and has no scheduler, so it cannot honor a
    // delay. A delayed message (e.g. the scheduled-status publish job) is
    // dropped rather than run immediately: running it now would either publish
    // ahead of time or, because the publish job re-enqueues itself while still
    // early, recurse forever. Without a real queue (QStash) or a cron driving
    // due rows, scheduled statuses simply do not auto-fire under NoQueue.
    if (message.delaySeconds && message.delaySeconds > 0) return
    await this.handle(message)
  }

  async handle(message: JobMessage) {
    return defaultJobHandle('noqueue')(message)
  }
}
