import memoize from 'lodash/memoize'

import { getConfig } from '@/lib/config'

import { CloudTasksQueue } from './cloudtasks'
import { DatabaseQueue } from './database'
import { NoQueue } from './noqueue'
import { QStashQueue } from './qstash'

export const getQueue = memoize(() => {
  const config = getConfig()
  switch (config.queue?.type) {
    case 'database': {
      return new DatabaseQueue(config.queue)
    }
    case 'qstash': {
      return new QStashQueue(config.queue)
    }
    case 'cloudtasks': {
      return new CloudTasksQueue(config.queue)
    }
    default: {
      return new NoQueue()
    }
  }
})
