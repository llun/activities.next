import { defaultJobHandle } from './base'
import { JobMessage, Queue } from './type'

export class NoQueue implements Queue {
  async publish<T>(message: JobMessage<T>): Promise<void> {
    await this.handle(message)
  }

  handle<T>(message: JobMessage<T>) {
    return defaultJobHandle('noqueue')(message)
  }
}
