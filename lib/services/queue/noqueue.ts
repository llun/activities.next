import { defaultJobHandle } from './base'
import { JobMessage, Queue } from './type'

export class NoQueue implements Queue {
  async publish(message: JobMessage) {
    await this.handle(message)
  }

  async publishDelayed(message: JobMessage, _delay: number) {
    await this.handle(message)
  }

  async handle(message: JobMessage) {
    return defaultJobHandle('noqueue')(message)
  }
}
