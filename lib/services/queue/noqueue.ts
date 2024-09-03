import { defaultJobHandle } from './base'
import { JobMessage, Queue } from './type'

export class NoQueue implements Queue {
  async publish(message: JobMessage): Promise<void> {
    await this.handle(message)
  }

  handle(message: JobMessage) {
    return defaultJobHandle('noqueue')(message)
  }
}
