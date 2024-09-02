import { BaseQueue } from './base'
import { JobMessage } from './type'

export class NoQueue extends BaseQueue {
  async publish(message: JobMessage): Promise<void> {
    await this.handle(message)
  }
}
