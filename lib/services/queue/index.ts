import memoize from 'lodash/memoize'

import { getConfig } from '@/lib/config'

import { NoQueue } from './noqueue'
import { QStashQueue } from './qstash'

export const getQueue = memoize(() => {
  const config = getConfig()
  switch (config.queue?.type) {
    case 'qstash': {
      return new QStashQueue(config.queue)
    }
    default: {
      return new NoQueue()
    }
  }
})
