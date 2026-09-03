import { CloudTasksConfig } from '@/lib/config/queue'
import { logger } from '@/lib/utils/logger'

import { defaultJobHandle } from './base'
import { JobMessage, Queue } from './type'

export class CloudTasksQueue implements Queue {
  readonly runsInline = false

  private _config?: CloudTasksConfig

  constructor(config?: CloudTasksConfig) {
    this._config = config
  }

  async publish(message: JobMessage): Promise<void> {
    logger.debug(
      { jobName: message.name, id: message.id, config: this._config },
      'CloudTasksQueue publish called'
    )
  }

  handle(message: JobMessage) {
    return defaultJobHandle('cloudtasks')(message)
  }
}
